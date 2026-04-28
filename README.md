# rn-ci-setup

[![npm version](https://img.shields.io/npm/v/rn-ci-setup.svg)](https://www.npmjs.com/package/rn-ci-setup)

`rn-ci-setup` is a production-focused CLI to automate React Native CI/CD setup with GitHub Actions, Fastlane, signing, and GitHub Secrets management.

It is designed for teams that want a guided, repeatable setup flow with minimal manual file creation.

## Install

```bash
npm i -g rn-ci-setup
```

or run without global install:

```bash
npx rn-ci-setup init
```

## What It Automates

When you run `init`, the CLI orchestrates the full setup pipeline:

1. Validates Git repository state and bootstrap behavior
2. Creates GitHub repo with `gh` when `origin` is missing
3. Lets you choose the working branch and syncs it
4. Collects platform and template options
5. Configures optional Slack/Discord/Teams notifications
6. Generates GitHub workflows and Fastlane files
7. Runs Bundler setup
8. Runs interactive Fastlane setup commands
9. Configures GitHub Actions secrets via `gh`
10. Commits and pushes generated files (unless skipped)

## Commands

### `init`

```bash
npx rn-ci-setup init
```

Common flags:

- `--ci-provider <github|bitrise|codemagic>`: choose CI provider (default: `github`)
- `--android` / `--ios`: target platforms
- `--expo` / `--bare`: project template
- `--notify-slack`: enable Slack notification integration
- `--notify-discord`: enable Discord notification integration
- `--notify-teams`: enable Microsoft Teams notification integration
- `--app-path <path>`: target app path for monorepos
- `--skip-bundle`: skip `bundle install`
- `--skip-fastlane`: skip Fastlane initialization/signing commands
- `--skip-secrets`: skip GitHub secrets setup
- `--skip-push`: skip commit/push stage

Examples:

```bash
npx rn-ci-setup init --ci-provider github --android --ios
npx rn-ci-setup init --ci-provider bitrise --android --ios
npx rn-ci-setup init --ci-provider codemagic --ios --app-path apps/mobile
npx rn-ci-setup init --ios --app-path apps/mobile
npx rn-ci-setup init --android --ios --notify-slack --notify-teams
npx rn-ci-setup init --android --ios --skip-fastlane --skip-secrets
```

### `secrets`

Creates or updates required GitHub Actions secrets using GitHub CLI:

```bash
npx rn-ci-setup secrets
```

Optional repo override:

```bash
npx rn-ci-setup secrets --repo owner/repo
```

### `keys`

Prints a guided checklist to generate platform API keys and map them to the expected GitHub Actions secrets.

```bash
npx rn-ci-setup keys
```

Platform-scoped usage:

```bash
npx rn-ci-setup keys --ios
npx rn-ci-setup keys --android
npx rn-ci-setup keys --ios --android
```

### `doctor`

Checks required CI/CD values and warns on missing or weak placeholders:

```bash
npx rn-ci-setup doctor
```

## Generated Artifacts

Depending on selected targets, `init` generates:

- `.github/workflows/android.yml` (GitHub provider)
- `.github/workflows/ios.yml` (GitHub provider)
- `bitrise.yml` (Bitrise provider)
- `codemagic.yaml` (Codemagic provider)
- `Gemfile` (ensures Fastlane dependency)
- `ios/fastlane/Fastfile`
- `ios/fastlane/Appfile`
- `ios/fastlane/Matchfile`
- `android/fastlane/Fastfile`
- `.rn-ci-setup.json`

## CI Provider Notes

- **GitHub**: full automation path, including GitHub Actions secrets via `gh`.
- **Bitrise**: generates `bitrise.yml` and Fastlane files; secrets must be added in Bitrise dashboard.
- **Codemagic**: generates `codemagic.yaml` and Fastlane files; secrets must be added in Codemagic dashboard.

For Bitrise/Codemagic projects, `--skip-secrets` is effectively implied because GitHub secret automation is not used.

## Fastlane Flow Executed by CLI

For iOS, the CLI supports this setup flow:

- `cd ios && bundle exec fastlane init` (if missing)
- `cd ios && bundle exec fastlane match init` (if needed)
- `cd ios && bundle exec fastlane match appstore`
- `cd ios && bundle exec fastlane match development`

For Android, the CLI initializes Fastlane when needed:

- `cd android && bundle exec fastlane init`

## Workflow Trigger Strategy

Generated workflows follow this model:

- `pull_request` to `main`/`master`: run CI lanes
- `push` to `main`/`master`: run beta/distribution lanes
- `workflow_dispatch`: manual release lanes

## Required Secrets (GitHub Actions)

### iOS

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY`
- `MATCH_GIT_URL`
- `MATCH_PASSWORD`
- `APPLE_APP_IDENTIFIER`
- `APPLE_TEAM_ID`

Recommended:

- `APP_STORE_CONNECT_TEAM_ID`
- `FASTLANE_USER`

### Android

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

### Notifications (optional)

- `SLACK_WEBHOOK_URL`
- `DISCORD_WEBHOOK_URL`
- `TEAMS_WEBHOOK_URL`

## API Key Generation Guide

You can print this guide anytime from CLI:

```bash
npx rn-ci-setup keys --ios --android
```

### App Store Connect API Key (iOS)

1. Open App Store Connect -> Users and Access -> Integrations -> App Store Connect API.
2. Generate a key and download the `.p8` file.
3. Capture:
   - Key ID
   - Issuer ID
   - Full `.p8` key content
4. Add these secrets:
   - `APP_STORE_CONNECT_KEY_ID`
   - `APP_STORE_CONNECT_ISSUER_ID`
   - `APP_STORE_CONNECT_PRIVATE_KEY`
5. Ensure iOS signing secrets are also configured:
   - `MATCH_GIT_URL`
   - `MATCH_PASSWORD`
   - `APPLE_APP_IDENTIFIER`
   - `APPLE_TEAM_ID`

### Google Play Console API Key (Android)

1. Open Google Play Console -> Setup -> API access.
2. Link a Google Cloud project.
3. Create a service account in Google Cloud IAM.
4. Grant required Play Console permissions to that service account.
5. Create and download the service account JSON key.
6. If your Android release lanes need base64:

```bash
base64 -i play-service-account.json | tr -d '\n'
```

7. Configure Android signing secrets:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`

## Prerequisites

- Node.js and npm
- Git
- GitHub CLI (`gh`) authenticated
- Ruby and Bundler
- Xcode/CocoaPods for iOS pipelines
- Android toolchain for Android pipelines

## Local Development

```bash
npm install
node ./bin/index.js --help
node ./bin/index.js init
node ./bin/index.js secrets
node ./bin/index.js doctor
```

## Release to npm

```bash
npm version patch
npm publish
```

Use `minor` or `major` version bumps when appropriate.
