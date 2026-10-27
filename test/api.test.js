const { test } = require('node:test');
const assert = require('node:assert/strict');
const base = process.env.TEST_API_URL;
// Use an isolated test database: these checks create and delete records.
test('task API workflow', { skip: !base }, async () => {
    const users = [], tasks = [];
    async function request(path, method = 'GET', body, status = 200) {
        const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        assert.equal(response.status, status, JSON.stringify(data));
        assert.equal(typeof data.message, 'string');
        assert.ok('data' in data);
        return data.data;
    }
    const createUser = async name => { const u = await request('/users', 'POST', { name, email: `${name}-${Date.now()}@example.test` }, 201); users.push(u._id); return u; };
    try {
        const a = await createUser('Alice'), b = await createUser('Bob');
        await request('/users', 'POST', { name: 'Duplicate', email: a.email }, 400);
        await request('/users', 'POST', { name: 'Missing' }, 400);
        await request('/tasks', 'POST', { name: 'Missing deadline' }, 400);
        await request('/tasks', 'POST', { name: 'Bad boolean', deadline: '2030-01-01', completed: 'false' }, 400);
        const t = await request('/tasks', 'POST', { name: 'Work', deadline: '2030-01-01', assignedUser: a._id }, 201); tasks.push(t._id);
        assert.equal(t.assignedUserName, a.name);
        assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, [t._id]);
        const moved = await request(`/users/${b._id}`, 'PUT', { name: 'Robert', email: b.email, pendingTasks: [t._id] });
        assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, []);
        assert.equal((await request(`/tasks/${t._id}`)).assignedUserName, 'Robert');
        assert.equal(moved.dateCreated, b.dateCreated);
        await request(`/tasks/${t._id}`, 'PUT', { name: 'Done', deadline: '2030-01-02', completed: true, assignedUser: b._id });
        assert.deepEqual((await request(`/users/${b._id}`)).pendingTasks, []);
        await request(`/users/${b._id}`, 'PUT', { name: 'No', email: b.email, pendingTasks: [t._id] }, 400);
        assert.equal((await request(`/users/${b._id}`)).name, 'Robert');
        await request(`/users/${b._id}`, 'PUT', { name: 'Renamed', email: b.email });
        assert.equal((await request(`/tasks/${t._id}`)).assignedUserName, 'Renamed');
        await request(`/tasks/${t._id}`, 'PUT', { name: 'Pending', deadline: '2030-01-02', assignedUser: a._id });
        assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, [t._id]);
        await request(`/tasks/${t._id}`, 'PUT', { name: 'Invalid', deadline: '2030-01-02', assignedUser: a._id, assignedUserName: 'Wrong' }, 400);
        assert.equal((await request(`/tasks/${t._id}`)).name, 'Pending');
        const query = new URLSearchParams({ where: JSON.stringify({ _id: t._id }), select: '{"name":1,"_id":0}', sort: '{"name":-1}', skip: '0', limit: '1' });
        assert.deepEqual(await request(`/tasks?${query}`), [{ name: 'Pending' }]);
        assert.equal(await request(`/tasks?where=${encodeURIComponent(JSON.stringify({ _id: t._id }))}&count=true`), 1);
        assert.deepEqual(await request(`/tasks/${t._id}?select={"name":1,"_id":0}&where=invalid`), { name: 'Pending' });
        for (const suffix of ['where=no', 'sort={"name":3}', 'limit=-1', 'count=1', 'select={"name":1,"deadline":0}']) await request(`/tasks?${suffix}`, 'GET', undefined, 400);
        await request('/users/nope', 'PUT', {}, 404);
        await request('/tasks/000000000000000000000000', 'PUT', {}, 404);
        await request('/users', 'POST', { name: 'Bad refs', email: 'bad@example.test', pendingTasks: ['invalid'] }, 400);
        await request('/tasks', 'POST', { name: 'Missing user', deadline: '2030-01-01', assignedUser: '000000000000000000000000' }, 404);
        const completed = await request('/tasks', 'POST', { name: 'Historical', deadline: '2030-01-01', completed: true, assignedUser: a._id }, 201); tasks.push(completed._id);
        const unassigned = await request('/tasks', 'POST', { name: 'Unassigned', deadline: '2030-01-01' }, 201); tasks.push(unassigned._id);
        assert.equal(unassigned.assignedUserName, 'unassigned');
        assert.equal(unassigned.completed, false);
        const c = await request('/users', 'POST', { name: 'Carol', email: `carol-${Date.now()}@example.test`, pendingTasks: [unassigned._id] }, 201); users.push(c._id);
        assert.equal((await request(`/tasks/${unassigned._id}`)).assignedUser, c._id);
        await request(`/tasks/${unassigned._id}`, 'DELETE');
        assert.deepEqual((await request(`/users/${c._id}`)).pendingTasks, []);
        await request(`/users/${a._id}`, 'DELETE');
        assert.equal((await request(`/tasks/${completed._id}`)).assignedUserName, 'unassigned');
        assert.equal((await request(`/tasks/${t._id}`)).assignedUser, '');
        await request(`/tasks/${t._id}`, 'DELETE');
        await request(`/tasks/${t._id}`, 'GET', undefined, 404);
    } finally {
        for (const t of tasks) await fetch(`${base}/api/tasks/${t}`, { method: 'DELETE' });
        for (const u of users) await fetch(`${base}/api/users/${u}`, { method: 'DELETE' });
    }
});
