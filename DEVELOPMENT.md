# Run the API

Use Node 24 LTS, run `npm ci`, and set `MONGODB_URI` in the process environment or an ignored `.env` file. Use a MongoDB Atlas database or a local MongoDB replica set: mutations use transactions to keep users and tasks consistent and roll back failed requests. Standalone MongoDB servers do not support this workflow. The application creates the unique email index before accepting requests.

Run `npm start` (`npm run dev` for automatic restart). `PORT` defaults to 3000. `GET /api/` returns `{ "message": "OK", "data": {} }` without exposing connection credentials.

For integration tests, start a separate instance against an **isolated disposable database**, then run:

```sh
TEST_API_URL=http://127.0.0.1:3000 npm test
```

The suite creates and deletes test records. Without `TEST_API_URL` the suite is explicitly skipped; a skipped run does not verify the API. No tests contact the external course grader.

Deploy on Render with build command `npm ci`, start command `npm start`, and a securely configured `MONGODB_URI`. Then set the deployed URL in `submit.js` and run `npm run submit` for the course self-check. Deployment, Atlas credentials, and the grader run require your own account configuration.

The course README requires submitting LLM chatlogs and completing the LLM survey when generated code is used.
