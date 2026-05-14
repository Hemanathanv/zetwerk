# Prisma + PostgreSQL Setup

Set `DATABASE_URL` in `Backend/.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/zetwerk_ocr?schema=public"
```

Run from `Backend`:

```bash
npm install
npm run db:generate
npm run db:push
```

If you prefer migrations:

```bash
npm run db:migrate -- --name init_ocr_schema
```

# OCR API Server

Run backend OCR API:

```bash
npm run dev:api
```

Server defaults:

- Base URL: `http://localhost:8000`
- Upload endpoint: `POST /api/ocr/run` (`multipart/form-data` with `file` and `ocrType`)
- OCR type list: `GET /api/ocr/types`
