FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build


FROM python:3.12-slim AS production

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/api/pyproject.toml ./apps/api/pyproject.toml
COPY apps/api/ledgerly_api ./apps/api/ledgerly_api
RUN python -m pip install --no-cache-dir ./apps/api

COPY --from=frontend-build /app/dist ./dist

EXPOSE 10000

CMD ["sh", "-c", "python -m uvicorn ledgerly_api.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
