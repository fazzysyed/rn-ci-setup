# rn-ci-setup

[![npm version](https://img.shields.io/npm/v/rn-ci-setup.svg)](https://www.npmjs.com/package/rn-ci-setup)

CLI to scaffold React Native CI/CD configs, Fastlane setup, and GitHub Actions secrets.

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
- `--notify-slack`: add Slack notifications for push/PR merge/build status
- `--notify-discord`: add Discord notifications for push/PR merge/build status
- `--notify-teams`: add Microsoft Teams notifications for push/PR merge/build status
- `--app-path <path>`: target RN app directory in monorepos

Examples:

```bash
npx rn-ci-setup init --ci-provider github --android --ios --notify-slack --notify-teams
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
- `Gemfile` (for `bundle install` + Fastlane gems)
- `ios/fastlane/Fastfile`
- `ios/fastlane/Appfile`
- `ios/fastlane/Matchfile`
- `.env.example`
- `.env.production`
- `docs/github-secrets.md`
- `.rn-ci-setup.json`

## Fastlane lanes

Generated iOS lanes:

- `fastlane match`
- `fastlane development`
- `fastlane appstore`

When notification flags are enabled for GitHub provider, workflows also send webhook notifications for:

- push and pull request activity
- pull request merged
- build success or failure

GitHub iOS workflow runs:

- `bundle install` (project root)
- `cd ios && pod install`
- `cd ios && bundle exec fastlane match`
- `cd ios && bundle exec fastlane development`

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

## Key setup guide

### App Store Connect API key (for iOS/Fastlane)

1. Open [App Store Connect](https://appstoreconnect.apple.com/) -> **Users and Access** -> **Integrations** -> **App Store Connect API**.
2. Click **Generate API Key**.
3. Save these values:
   - **Key ID**
   - **Issuer ID**
   - Downloaded `.p8` private key file
4. Convert the `.p8` file to base64:

```bash
base64 -i AuthKey_XXXXXX.p8 | tr -d '\n'
```

5. Add to secrets/env:
   - `APPLE_API_KEY_ID` = Key ID
   - `APPLE_API_ISSUER_ID` = Issuer ID
   - `APPLE_API_KEY_BASE64` = base64 output
   - `APPLE_ID`, `APPLE_TEAM_ID`, `APP_STORE_CONNECT_TEAM_ID`, `APPLE_APP_IDENTIFIER`

### Google Play Console API key (for Android publishing)

1. Open [Google Play Console](https://play.google.com/console/) -> **Setup** -> **API access**.
2. Link a Google Cloud project (or create one).
3. In Google Cloud IAM, create a **Service Account**.
4. Grant required Play Console permissions to that service account user (Release manager/Admin as needed).
5. Create and download the service account JSON key.
6. Convert JSON key to base64:

```bash
base64 -i play-service-account.json | tr -d '\n'
```

7. Add to secrets/env:
   - `PLAY_STORE_JSON_KEY_BASE64` = base64 output
   - `ANDROID_PACKAGE_NAME` = your app package ID

### Tip

If you generated GitHub workflows, run:

```bash
npx rn-ci-setup secrets
```

This command helps you push required values into GitHub Actions secrets.

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
