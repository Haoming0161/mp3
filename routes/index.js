const mongoose = require('mongoose');
mongoose.set('transactionAsyncLocalStorage', true);
const User = require('../models/user');
const Task = require('../models/task');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const id = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
function string(body, key, required = false, fallback = '') {
    if (!own(body, key)) {
        if (required) fail(400, `${key} is required`);
        return fallback;
    }
    if (typeof body[key] !== 'string' || (required && !body[key].trim())) fail(400, `${key} must be a nonempty string`);
    return body[key];
}
function projection(value) {
    const result = json(value);
    if (!result || Array.isArray(result) || typeof result !== 'object' || Object.values(result).some(v => v !== 0 && v !== 1)) fail(400, 'Invalid select');
    const modes = new Set(Object.entries(result).filter(([k]) => k !== '_id').map(([,v]) => v));
    if (modes.size > 1) fail(400, 'Cannot mix included and excluded fields');
    return result;
}
function json(value) {
    if (typeof value !== 'string') fail(400, 'Query parameters must be JSON strings');
    try { return JSON.parse(value); } catch { fail(400, 'Invalid JSON query parameter'); }
}
function number(value, key) {
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail(400, `Invalid ${key}`);
    return Number(value);
}
async function existing(Model, value) {
    if (!id(value)) fail(404, 'Resource not found');
    const doc = await Model.findById(value);
    if (!doc) fail(404, 'Resource not found');
    return doc;
}
async function userFields(body, current) {
    const fields = { name: string(body, 'name', true), email: string(body, 'email', true), pendingTasks: body.pendingTasks === undefined ? [] : body.pendingTasks };
    if (!Array.isArray(fields.pendingTasks) || fields.pendingTasks.some(v => !id(v))) fail(400, 'pendingTasks must contain valid task IDs');
    fields.pendingTasks = [...new Set(fields.pendingTasks.map(v => v.toLowerCase()))];
    const duplicate = await User.findOne({ email: fields.email });
    if (duplicate && (!current || !duplicate._id.equals(current._id))) fail(400, 'Email is already in use');
    const tasks = await Task.find({ _id: { $in: fields.pendingTasks } });
    if (tasks.some(t => t.completed)) fail(400, 'Completed tasks cannot be pending');
    if (tasks.length !== fields.pendingTasks.length) fail(404, 'Referenced task not found');
    return fields;
}
async function taskFields(body) {
    const fields = { name: string(body, 'name', true), description: string(body, 'description'), assignedUser: string(body, 'assignedUser'), completed: body.completed === undefined ? false : body.completed };
    if (typeof fields.completed !== 'boolean') fail(400, 'completed must be a boolean');
    if (!own(body, 'deadline') || (typeof body.deadline !== 'string' && typeof body.deadline !== 'number') || !Number.isFinite(new Date(body.deadline).getTime())) fail(400, 'A valid deadline is required');
    fields.deadline = new Date(body.deadline);
    if (fields.assignedUser && !id(fields.assignedUser)) fail(400, 'Invalid assignedUser ID');
    if (own(body, 'assignedUserName') && typeof body.assignedUserName !== 'string') fail(400, 'assignedUserName must be a string');
    if (fields.assignedUser) {
        const user = await User.findById(fields.assignedUser);
        if (!user) fail(404, 'Assigned user not found');
        if (own(body, 'assignedUserName') && body.assignedUserName !== user.name) fail(400, 'assignedUserName does not match user');
        fields.assignedUser = String(user._id);
        fields.assignedUserName = user.name;
    } else fields.assignedUserName = 'unassigned';
    return fields;
}
// Serialize mutations so concurrent requests cannot interleave reference updates.
let queue = Promise.resolve();
function mutation(fn) {
    return (req, res, next) => {
        const run = queue.then(async () => {
            let status = 200;
            let payload;
            const response = { status(code) { status = code; return this; }, json(body) { payload = body; } };
            await mongoose.connection.transaction(() => fn(req, response));
            res.status(status).json(payload);
        });
        queue = run.catch(() => {});
        run.catch(next);
    };
}
module.exports = function (app, router) {
    require('./home')(router);
    for (const [resource, Model] of [['users', User], ['tasks', Task]]) {
        const isUser = resource === 'users';
        router.get(`/${resource}`, async (req, res, next) => {
            try {
                const q = req.query;
                const where = q.where === undefined ? {} : json(q.where);
                if (!where || typeof where !== 'object' || Array.isArray(where)) fail(400, 'where must be an object');
                const select = q.select === undefined ? undefined : projection(q.select);
                const sort = q.sort === undefined ? undefined : json(q.sort);
                if (sort !== undefined && (!sort || Array.isArray(sort) || typeof sort !== 'object' || Object.values(sort).some(v => v !== 1 && v !== -1))) fail(400, 'Invalid sort');
                const skip = q.skip === undefined ? 0 : number(q.skip, 'skip');
                const limit = q.limit === undefined ? (isUser ? 0 : 100) : number(q.limit, 'limit');
                const count = q.count === undefined ? false : json(q.count);
                if (typeof count !== 'boolean') fail(400, 'count must be boolean');
                const data = count ? await Model.countDocuments(where) : await Model.find(where).select(select).sort(sort).skip(skip).limit(limit);
                res.json({ message: 'OK', data });
            } catch (e) { next(e); }
        });
        router.get(`/${resource}/:id`, async (req, res, next) => {
            try {
                await existing(Model, req.params.id);
                const select = req.query.select === undefined ? undefined : projection(req.query.select);
                res.json({ message: 'OK', data: await Model.findById(req.params.id).select(select) });
            } catch (e) { next(e); }
        });
        async function save(req, res) {
            const current = req.method === 'PUT' ? await existing(Model, req.params.id) : null;
            if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail(400, 'A request object is required');
            const fields = isUser ? await userFields(req.body, current) : await taskFields(req.body);
            const doc = current || new Model();
            const key = String(doc._id);
            if (isUser) {
                const removed = (current ? current.pendingTasks : []).filter(v => !fields.pendingTasks.includes(v));
                await Task.updateMany({ _id: { $in: removed }, assignedUser: key }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } });
                await User.updateMany({ _id: { $ne: doc._id } }, { $pull: { pendingTasks: { $in: fields.pendingTasks } } });
                await Task.updateMany({ _id: { $in: fields.pendingTasks } }, { $set: { assignedUser: key, assignedUserName: fields.name } });
                await Task.updateMany({ assignedUser: key }, { $set: { assignedUserName: fields.name } });
            } else {
                await User.updateMany({ pendingTasks: key }, { $pull: { pendingTasks: key } });
                if (fields.assignedUser && !fields.completed) await User.updateOne({ _id: fields.assignedUser }, { $addToSet: { pendingTasks: key } });
            }
            Object.assign(doc, fields);
            await doc.save();
            res.status(current ? 200 : 201).json({ message: current ? 'Updated' : 'Created', data: doc });
        }
        router.post(`/${resource}`, mutation(save));
        router.put(`/${resource}/:id`, mutation(save));
        router.delete(`/${resource}/:id`, mutation(async (req, res) => {
            const doc = await existing(Model, req.params.id);
            const key = String(doc._id);
            if (isUser) await Task.updateMany({ assignedUser: key }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } });
            else await User.updateMany({ pendingTasks: key }, { $pull: { pendingTasks: key } });
            await doc.deleteOne();
            res.json({ message: 'Deleted', data: {} });
        }));
    }
    app.use('/api', router);
    app.use((req, res) => res.status(404).json({ message: 'Resource not found', data: {} }));
    app.use((err, req, res, next) => {
        const bad = err.status === 400 || ['CastError', 'ValidationError', 'StrictModeError'].includes(err.name) || err.code === 11000;
        const status = bad ? 400 : err.status === 404 ? 404 : 500;
        res.status(status).json({ message: status === 500 ? 'An unexpected server error occurred' : err.status ? err.message : 'Invalid request', data: {} });
    });
};
