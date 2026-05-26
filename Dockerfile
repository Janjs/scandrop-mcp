# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS web-builder

WORKDIR /app/web

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm AS python-deps

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
COPY scandrop/ ./scandrop/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN uv sync --frozen --no-dev \
    && /app/.venv/bin/python -c "from scandrop.main import main"

FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=python-deps /app/.venv /app/.venv
COPY --from=python-deps /app/scandrop /app/scandrop
COPY --from=python-deps /app/pyproject.toml /app/pyproject.toml

COPY --from=web-builder /app/web/.next/standalone ./web/
COPY --from=web-builder /app/web/.next/static ./web/.next/static
COPY --from=web-builder /app/web/public ./web/public

RUN mkdir -p /app/data/uploads /app/data/scenes

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SCANDROP_REPO_ROOT=/app \
    SCANDROP_PYTHON=/app/.venv/bin/python \
    SCANDROP_DATA_DIR=/app/data/scenes \
    PYTHONPATH=/app \
    PATH="/app/.venv/bin:${PATH}"

RUN test -x /app/.venv/bin/python

WORKDIR /app/web

EXPOSE 3000

CMD ["node", "server.js"]
