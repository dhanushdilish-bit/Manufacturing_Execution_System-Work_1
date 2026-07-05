# Manufacturing Execution System MVP

Local React + SQLite manufacturing execution system based on the supplied workflow PDF.

## Run locally

```bash
npm install
npm run init-db
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

## Seeded users

All seeded users use password `demo123`.

| Username | Role |
| --- | --- |
| admin | Admin / Manager |
| rm.manager | RM Store Manager |
| production | Production Team |
| qc.supervisor | QC Supervisor |
| fg.manager | FG Store Manager |
| dispatch | Dispatch / Sales / Office |

## Useful commands

```bash
npm run test
npm run build
npm run server
```

The SQLite database is created at `data/mes.sqlite` and is intentionally ignored by Git.
