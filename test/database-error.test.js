const { test } = require('node:test');
const assert = require('node:assert/strict');
const diagnose = require('../lib/database-error');

test('startup diagnostics distinguish actionable failures without exposing credentials', () => {
    const secret = 'mongodb+srv://private-user:private-password@private-host/secret-db';
    const cases = [
        [{ code: 18 }, 'AUTHENTICATION_FAILED'],
        [{ message: `bad auth ${secret}` }, 'AUTHENTICATION_FAILED'],
        [{ code: 13 }, 'PERMISSION_DENIED'],
        [{ code: 11000 }, 'DUPLICATE_EMAIL_INDEX'],
        [{ cause: { code: 'ENOTFOUND' } }, 'DNS_FAILED'],
        [{ name: 'MongoParseError' }, 'INVALID_URI'],
        [{ message: `certificate verification failed ${secret}` }, 'TLS_FAILED'],
        [{ name: 'MongooseServerSelectionError' }, 'CONNECTION_FAILED'],
        [{ reason: { servers: new Map([['private-host', { error: { code: 18 } }]]) } }, 'AUTHENTICATION_FAILED'],
        [{ message: secret }, 'DATABASE_INIT_FAILED']
    ];
    for (const [error, category] of cases) {
        error.message = error.message || secret;
        const result = diagnose(error);
        assert.ok(result.startsWith(`${category}:`));
        for (const sensitive of ['private-user', 'private-password', 'private-host', 'secret-db']) assert.ok(!result.includes(sensitive));
    }
    const circular = {}; circular.cause = circular;
    assert.ok(diagnose(circular).startsWith('DATABASE_INIT_FAILED:'));
});
