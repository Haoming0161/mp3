// Return fixed diagnostic text only: driver messages may contain credentials or URIs.
module.exports = function databaseError(error) {
    const pending = [error];
    const seen = new Set();
    const errors = [];
    while (pending.length && seen.size < 100) {
        const item = pending.shift();
        if (!item || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);
        errors.push(item);
        pending.push(item.cause, item.reason, item.error);
        if (item.servers instanceof Map) {
            for (const server of item.servers.values()) pending.push(server);
        }
    }
    const matches = predicate => errors.some(predicate);
    if (matches(e => e.code === 18 || /authentication failed|bad auth/i.test(e.message || ''))) {
        return 'AUTHENTICATION_FAILED: Check the Atlas database username, password and password URL encoding in MONGODB_URI.';
    }
    if (matches(e => e.code === 13 || /not authorized/i.test(e.message || ''))) {
        return 'PERMISSION_DENIED: Give the database user read/write access to the application database, including permission to create indexes.';
    }
    if (matches(e => e.code === 11000)) {
        return 'DUPLICATE_EMAIL_INDEX: Existing duplicate email values prevent creation of the unique index. Inspect existing user records before changing data.';
    }
    if (matches(e => ['ENOTFOUND', 'ENODATA', 'ESERVFAIL'].includes(e.code))) {
        return 'DNS_FAILED: Check the cluster hostname in MONGODB_URI and that the Atlas cluster exists and is active.';
    }
    if (matches(e => ['MongoParseError', 'MongoInvalidArgumentError'].includes(e.name))) {
        return 'INVALID_URI: Copy the Atlas Drivers connection string, replace placeholders, URL-encode the password, and remove outer quotes.';
    }
    if (matches(e => /TLS|certificate|SSL/i.test(e.message || ''))) {
        return 'TLS_FAILED: Check the runtime certificate trust and Atlas TLS connectivity. Do not disable certificate verification.';
    }
    if (matches(e => e.name === 'MongooseServerSelectionError' || e.name === 'MongoServerSelectionError' || ['ECONNREFUSED', 'ETIMEDOUT'].includes(e.code))) {
        return 'CONNECTION_FAILED: Check the Atlas IP access list, cluster availability and network connectivity from Render.';
    }
    return 'DATABASE_INIT_FAILED: Check the connection settings and database index configuration. Raw driver details are omitted to protect credentials.';
};
