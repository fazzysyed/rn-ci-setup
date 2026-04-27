# rn-ci-setup

[![npm version](https://img.shields.io/npm/v/rn-ci-setup.svg)](https://www.npmjs.com/package/rn-ci-setup)

CLI to scaffold React Native CI/CD configs and manage GitHub Actions secrets.

## Install

```bash
npm i -g rn-ci-setup
```

Or use directly:

```bash
npx rn-ci-setup init
```

## Usage

```bash
npx rn-ci-setup init
```

Flags:

- `--ci-provider <github|bitrise|codemagic>`: choose generated CI config
- `--android`: generate Android CI config
- `--ios`: generate iOS CI config
- `--expo` / `--bare`: choose template mode
- `--app-path <path>`: target RN app directory in monorepos

Examples:

```bash
npx rn-ci-setup init --ci-provider github --android --ios
npx rn-ci-setup init --ci-provider bitrise --android --ios
npx rn-ci-setup init --ci-provider codemagic --ios
npx rn-ci-setup init --android
npx rn-ci-setup init --android --expo
npx rn-ci-setup init --ios --app-path apps/mobile
```

## Generated files

- `.github/workflows/android.yml` (GitHub provider)
- `.github/workflows/ios.yml` (GitHub provider)
- `bitrise.yml` (Bitrise provider)
- `codemagic.yaml` (Codemagic provider)
- `.env.example`
- `.env.production`
- `docs/github-secrets.md`
- `.rn-ci-setup.json`

## GitHub secrets command

Create/update required GitHub Actions secrets using `gh`:

```bash
npx rn-ci-setup secrets
```

Optional repo override:

```bash
npx rn-ci-setup secrets --repo owner/repo
```

## Doctor command

Validate required secrets and env values:

```bash
npx rn-ci-setup doctor
```

It checks `.env.production`, `.env.example`, and shell env vars against the setup profile.

## Local development

```bash
npm install
npm run init -- --android --ios
npm run secrets
npm run doctor
```

## Publish automation

This repo publishes to npm from GitHub Actions:

- npm: `rn-ci-setup`

Workflow file: `.github/workflows/publish.yml`

Required secret:

- `NPM_TOKEN` (from npm access tokens with publish permission)

How to release:

1. Bump version in `package.json` (or use `npm version patch|minor|major`)
2. Push commit and tag
3. Create/publish a GitHub Release for that tag
4. Workflow publishes to npm automatically
