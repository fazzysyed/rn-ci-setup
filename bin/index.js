#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const inquirer = require("inquirer").default;

const CONFIG_FILE = ".rn-ci-setup.json";

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getArg(index) {
  return process.argv[index];
}

function getFlagValue(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileSafe(targetPath, content) {
  const dirPath = path.dirname(targetPath);
  ensureDir(dirPath);
  const exists = fs.existsSync(targetPath);
  fs.writeFileSync(targetPath, content, "utf8");
  console.log(`${exists ? "Updated" : "Created"} ${path.relative(process.cwd(), targetPath)}`);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    env[key] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function detectRnApps(rootDir) {
  const searchRoots = [".", "apps", "packages"];
  const detected = new Set();

  for (const searchRoot of searchRoots) {
    const absRoot = path.join(rootDir, searchRoot);
    if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) continue;
    const entries = fs.readdirSync(absRoot, { withFileTypes: true });
    const candidates = searchRoot === "." ? ["."] : [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      candidates.push(path.join(searchRoot, entry.name));
    }

    for (const rel of candidates) {
      const pkgPath = path.join(rootDir, rel, "package.json");
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = readJsonSafe(pkgPath);
      const deps = Object.assign({}, pkg?.dependencies || {}, pkg?.devDependencies || {});
      const isRn = Boolean(deps["react-native"] || deps["expo"]);
      const hasNative = fs.existsSync(path.join(rootDir, rel, "android")) || fs.existsSync(path.join(rootDir, rel, "ios"));
      if (isRn || hasNative) detected.add(rel.replace(/\\/g, "/"));
    }
  }

  return Array.from(detected).sort();
}

function getRelativeWorkDir(targetRoot) {
  const rel = path.relative(process.cwd(), targetRoot).replace(/\\/g, "/");
  return rel || ".";
}

function getBashCdPrefix(wd) {
  return wd === "." ? "" : `cd ${wd} && `;
}

function getNotificationJobs(options) {
  if (options.ciProvider !== "github") return "";
  if (!options.notifications?.slack && !options.notifications?.discord && !options.notifications?.teams) return "";

  const eventMessage = "rn-ci-setup | ${GITHUB_REPOSITORY} | workflow=${GITHUB_WORKFLOW} | event=${GITHUB_EVENT_NAME} | ref=${GITHUB_REF_NAME} | status=${{ needs.build.result }}";
  const mergeMessage = "rn-ci-setup | ${GITHUB_REPOSITORY} | PR merged #${{ github.event.pull_request.number }} - ${{ github.event.pull_request.title }}";

  const lines = [
    "",
    "  notify:",
    "    runs-on: ubuntu-latest",
    "    needs: [build]",
    "    if: always()",
    "    steps:"
  ];

  if (options.notifications.slack) {
    lines.push("      - name: Notify Slack");
    lines.push("        if: ${{ secrets.SLACK_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${eventMessage}\\\"}" "$SLACK_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}");
  }

  if (options.notifications.discord) {
    lines.push("      - name: Notify Discord");
    lines.push("        if: ${{ secrets.DISCORD_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"content\\\":\\\"${eventMessage}\\\"}" "$DISCORD_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}");
  }

  if (options.notifications.teams) {
    lines.push("      - name: Notify Microsoft Teams");
    lines.push("        if: ${{ secrets.TEAMS_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${eventMessage}\\\"}" "$TEAMS_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}");
  }

  lines.push("");
  lines.push("  notify_pr_merged:");
  lines.push("    runs-on: ubuntu-latest");
  lines.push("    if: github.event_name == 'pull_request' && github.event.action == 'closed' && github.event.pull_request.merged == true");
  lines.push("    steps:");

  if (options.notifications.slack) {
    lines.push("      - name: Notify Slack PR merged");
    lines.push("        if: ${{ secrets.SLACK_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${mergeMessage}\\\"}" "$SLACK_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}");
  }

  if (options.notifications.discord) {
    lines.push("      - name: Notify Discord PR merged");
    lines.push("        if: ${{ secrets.DISCORD_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"content\\\":\\\"${mergeMessage}\\\"}" "$DISCORD_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}");
  }

  if (options.notifications.teams) {
    lines.push("      - name: Notify Teams PR merged");
    lines.push("        if: ${{ secrets.TEAMS_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${mergeMessage}\\\"}" "$TEAMS_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}");
  }

  return `\n${lines.join("\n")}\n`;
}

function getAndroidWorkflow(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const expoPrebuild = options.template === "expo"
    ? `\n      - name: Expo prebuild (Android)\n        run: npx expo prebuild --platform android --non-interactive\n        working-directory: ${wd}\n`
    : "";

  return `name: Android CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, closed]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install deps
        run: npm ci
        working-directory: ${wd}
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17${expoPrebuild}
      - name: Build Android release
        run: ./gradlew assembleRelease
        working-directory: ${wd}/android
${getNotificationJobs(options)}`;
}

function getIosWorkflow(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const expoPrebuild = options.template === "expo"
    ? `\n      - name: Expo prebuild (iOS)\n        run: npx expo prebuild --platform ios --non-interactive\n        working-directory: ${wd}\n`
    : "";
  return `name: iOS CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, closed]

jobs:
  build:
    runs-on: macos-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install deps
        run: npm ci
        working-directory: ${wd}
      - name: Install Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.2"${expoPrebuild}
      - name: Install gems
        run: bundle install
        working-directory: ${wd}
      - name: Install CocoaPods
        run: pod install
        working-directory: ${wd}/ios
      - name: Fastlane match
        run: cd ios && bundle exec fastlane match
        working-directory: ${wd}
      - name: Fastlane development
        run: cd ios && bundle exec fastlane development
        working-directory: ${wd}
      - name: Build iOS
        run: xcodebuild -workspace *.xcworkspace -scheme \${IOS_SCHEME:-App} -sdk iphonesimulator -configuration Release build
        working-directory: ${wd}/ios
${getNotificationJobs(options)}`;
}

function getRootGemfile() {
  return `source "https://rubygems.org"

gem "fastlane"
`;
}

function getIosFastfile() {
  return `default_platform(:ios)

platform :ios do
  desc "Sync signing certificates and profiles"
  lane :match do
    match(type: "appstore", readonly: true)
  end

  desc "Build development/TestFlight-ready iOS app"
  lane :development do
    build_app(
      workspace: ENV["IOS_WORKSPACE"] || "App.xcworkspace",
      scheme: ENV["IOS_SCHEME"] || "App",
      export_method: "app-store"
    )
  end

  desc "Build and upload to App Store Connect"
  lane :appstore do
    build_app(
      workspace: ENV["IOS_WORKSPACE"] || "App.xcworkspace",
      scheme: ENV["IOS_SCHEME"] || "App",
      export_method: "app-store"
    )
    upload_to_app_store
  end
end
`;
}

function getIosAppfile() {
  return `app_identifier(ENV["APPLE_APP_IDENTIFIER"])
apple_id(ENV["APPLE_ID"])
itc_team_id(ENV["APP_STORE_CONNECT_TEAM_ID"])
team_id(ENV["APPLE_TEAM_ID"])
`;
}

function getIosMatchfile() {
  return `git_url(ENV["MATCH_GIT_URL"])
storage_mode("git")
type("appstore")
app_identifier([ENV["APPLE_APP_IDENTIFIER"]])
username(ENV["APPLE_ID"])
`;
}

function getBitriseConfig(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const cdPrefix = getBashCdPrefix(wd);
  const lines = [
    "format_version: '11'",
    "default_step_lib_source: https://github.com/bitrise-io/bitrise-steplib.git",
    "project_type: react-native",
    "workflows:",
    "  primary:",
    "    steps:",
    "      - activate-ssh-key@4: {}",
    "      - git-clone@8: {}",
    "      - npm@1:",
    "          inputs:",
    "            - command: ci"
  ];

  if (options.template === "expo") {
    if (options.targets.android) {
      lines.push("      - script@1:");
      lines.push("          title: Expo prebuild Android");
      lines.push(`          inputs: ["content: |\\n              ${cdPrefix}npx expo prebuild --platform android --non-interactive"]`);
    }
    if (options.targets.ios) {
      lines.push("      - script@1:");
      lines.push("          title: Expo prebuild iOS");
      lines.push(`          inputs: ["content: |\\n              ${cdPrefix}npx expo prebuild --platform ios --non-interactive"]`);
    }
  }

  if (options.targets.android) {
    lines.push("      - script@1:");
    lines.push("          title: Build Android release");
    lines.push(`          inputs: ["content: |\\n              ${cdPrefix}cd android && ./gradlew assembleRelease"]`);
  }
  if (options.targets.ios) {
    lines.push("      - script@1:");
    lines.push("          title: Build iOS");
    lines.push(
      `          inputs: ["content: |\\n              ${cdPrefix}cd ios && pod install && xcodebuild -workspace *.xcworkspace -scheme \${IOS_SCHEME:-App} -sdk iphonesimulator -configuration Release build"]`
    );
  }

  return `${lines.join("\n")}\n`;
}

function getCodemagicConfig(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const rootPrefix = wd === "." ? "" : `${wd}/`;
  const scripts = ["      - name: Install deps", `        script: cd ${wd} && npm ci`];

  if (options.template === "expo") {
    if (options.targets.android) {
      scripts.push("      - name: Expo prebuild Android");
      scripts.push(`        script: cd ${wd} && npx expo prebuild --platform android --non-interactive`);
    }
    if (options.targets.ios) {
      scripts.push("      - name: Expo prebuild iOS");
      scripts.push(`        script: cd ${wd} && npx expo prebuild --platform ios --non-interactive`);
    }
  }

  if (options.targets.android) {
    scripts.push("      - name: Build Android");
    scripts.push(`        script: cd ${wd}/android && ./gradlew assembleRelease`);
  }
  if (options.targets.ios) {
    scripts.push("      - name: Build iOS");
    scripts.push(
      `        script: cd ${wd}/ios && pod install && xcodebuild -workspace *.xcworkspace -scheme \${IOS_SCHEME:-App} -sdk iphonesimulator -configuration Release build`
    );
  }

  return `workflows:
  react_native_ci:
    name: React Native CI
    max_build_duration: 120
    environment:
      node: 20
      xcode: latest
    scripts:
${scripts.join("\n")}
    artifacts:
      - ${rootPrefix}android/app/build/outputs/**/*.apk
      - ${rootPrefix}android/app/build/outputs/**/*.aab
`;
}

function getSecretsChecklist(options) {
  const required = ["NODE_ENV"];
  const recommended = [];

  if (options.targets.android) {
    required.push("ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD");
  }

  if (options.targets.ios) {
    recommended.push("IOS_SCHEME", "IOS_WORKSPACE");
    required.push(
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER_ID",
      "APPLE_API_KEY_BASE64",
      "APPLE_ID",
      "APPLE_TEAM_ID",
      "APP_STORE_CONNECT_TEAM_ID",
      "APPLE_APP_IDENTIFIER",
      "MATCH_GIT_URL",
      "MATCH_PASSWORD"
    );
  }

  if (options.notifications?.slack) required.push("SLACK_WEBHOOK_URL");
  if (options.notifications?.discord) required.push("DISCORD_WEBHOOK_URL");
  if (options.notifications?.teams) required.push("TEAMS_WEBHOOK_URL");

  return { required, recommended };
}

function getEnvExample(options) {
  const lines = ["# Shared", "NODE_ENV=production", ""];
  if (options.targets.android) {
    lines.push("# Android", "ANDROID_KEYSTORE_BASE64=", "ANDROID_KEYSTORE_PASSWORD=", "ANDROID_KEY_ALIAS=", "ANDROID_KEY_PASSWORD=");
    lines.push("");
  }
  if (options.targets.ios) {
    lines.push("# iOS", "IOS_SCHEME=App", "IOS_WORKSPACE=ios/App.xcworkspace");
    lines.push("APPLE_API_KEY_ID=", "APPLE_API_ISSUER_ID=", "APPLE_API_KEY_BASE64=");
    lines.push("APPLE_ID=", "APPLE_TEAM_ID=", "APP_STORE_CONNECT_TEAM_ID=");
    lines.push("APPLE_APP_IDENTIFIER=com.example.app");
    lines.push("MATCH_GIT_URL=", "MATCH_PASSWORD=");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function getEnvProduction(options) {
  const lines = ["NODE_ENV=production"];
  if (options.targets.ios) lines.push("IOS_SCHEME=App", "IOS_WORKSPACE=ios/App.xcworkspace");
  return `${lines.join("\n")}\n`;
}

function getSecretsGuide(options) {
  const checklist = getSecretsChecklist(options);
  const secretsLocation =
    options.ciProvider === "github"
      ? "GitHub repo -> Settings -> Secrets and variables -> Actions"
      : options.ciProvider === "bitrise"
        ? "Bitrise app -> Workflow Editor -> Secrets"
        : "Codemagic app -> Environment variables";
  const lines = [
    "# CI Secrets checklist",
    "",
    `Add these in: ${secretsLocation}`,
    "",
    `- App path: \`${options.appPath}\``,
    `- CI provider: \`${options.ciProvider}\``,
    `- Template: \`${options.template}\``,
    "",
    "## Required"
  ];
  for (const key of checklist.required) lines.push(`- [ ] ${key}`);
  lines.push("", "## Recommended");
  for (const key of checklist.recommended) lines.push(`- [ ] ${key}`);
  if (options.ciProvider === "github") {
    lines.push("", "Create GitHub secrets automatically:", "```bash", "rn-ci-setup secrets", "```", "");
  }
  lines.push("", "Validate locally:", "```bash", "rn-ci-setup doctor", "```", "");
  return `${lines.join("\n")}\n`;
}

async function resolveAppPath(cwd) {
  const flagPath = getFlagValue("app-path");
  if (flagPath) return flagPath;
  const apps = detectRnApps(cwd);
  if (apps.length <= 1) return apps[0] || ".";
  const answers = await inquirer.prompt([{ type: "list", name: "appPath", message: "Detected multiple React Native apps. Pick one:", choices: apps }]);
  return answers.appPath;
}

async function resolveTargets() {
  const cliTargets = { android: hasFlag("android"), ios: hasFlag("ios") };
  if (cliTargets.android || cliTargets.ios) return cliTargets;
  const answers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "platforms",
      message: "Which platform CI/CD do you want to generate?",
      choices: [{ name: "Android", value: "android", checked: true }, { name: "iOS", value: "ios", checked: true }],
      validate: (value) => (value.length > 0 ? true : "Select at least one platform.")
    }
  ]);
  return { android: answers.platforms.includes("android"), ios: answers.platforms.includes("ios") };
}

async function resolveTemplate() {
  if (hasFlag("expo")) return "expo";
  if (hasFlag("bare")) return "bare";
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "template",
      message: "Project template type?",
      choices: [{ name: "Bare React Native", value: "bare" }, { name: "Expo (prebuild in CI)", value: "expo" }],
      default: "bare"
    }
  ]);
  return answers.template;
}

async function resolveCiProvider() {
  const flagProvider = getFlagValue("ci-provider");
  if (flagProvider) {
    const normalized = flagProvider.toLowerCase();
    if (["github", "bitrise", "codemagic"].includes(normalized)) return normalized;
    throw new Error(`Unsupported --ci-provider value "${flagProvider}". Use github, bitrise, or codemagic.`);
  }

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "ciProvider",
      message: "Choose CI provider:",
      choices: [
        { name: "GitHub Actions", value: "github" },
        { name: "Bitrise", value: "bitrise" },
        { name: "Codemagic", value: "codemagic" }
      ],
      default: "github"
    }
  ]);
  return answers.ciProvider;
}

async function resolveNotifications() {
  const fromFlags = {
    slack: hasFlag("notify-slack"),
    discord: hasFlag("notify-discord"),
    teams: hasFlag("notify-teams")
  };

  if (fromFlags.slack || fromFlags.discord || fromFlags.teams) {
    return fromFlags;
  }

  const answers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "channels",
      message: "Add notification channels for push/PR merge/build status?",
      choices: [
        { name: "Slack", value: "slack" },
        { name: "Discord", value: "discord" },
        { name: "Microsoft Teams", value: "teams" }
      ]
    }
  ]);

  return {
    slack: answers.channels.includes("slack"),
    discord: answers.channels.includes("discord"),
    teams: answers.channels.includes("teams")
  };
}

function validateAppPath(cwd, appPath, targets) {
  const root = path.join(cwd, appPath);
  if (targets.android && !fs.existsSync(path.join(root, "android"))) throw new Error(`Selected app path "${appPath}" does not contain android/`);
  if (targets.ios && !fs.existsSync(path.join(root, "ios"))) throw new Error(`Selected app path "${appPath}" does not contain ios/`);
}

function writeScaffold(options) {
  if (options.ciProvider === "github") {
    if (options.targets.android) {
      writeFileSafe(path.join(options.targetRoot, ".github/workflows/android.yml"), getAndroidWorkflow(options));
    }
    if (options.targets.ios) {
      writeFileSafe(path.join(options.targetRoot, ".github/workflows/ios.yml"), getIosWorkflow(options));
    }
  }
  if (options.ciProvider === "bitrise") {
    writeFileSafe(path.join(options.targetRoot, "bitrise.yml"), getBitriseConfig(options));
  }
  if (options.ciProvider === "codemagic") {
    writeFileSafe(path.join(options.targetRoot, "codemagic.yaml"), getCodemagicConfig(options));
  }

  writeFileSafe(path.join(options.targetRoot, ".env.example"), getEnvExample(options));
  writeFileSafe(path.join(options.targetRoot, ".env.production"), getEnvProduction(options));
  writeFileSafe(path.join(options.targetRoot, "docs/github-secrets.md"), getSecretsGuide(options));
  if (options.targets.ios) {
    writeFileSafe(path.join(options.targetRoot, "Gemfile"), getRootGemfile());
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Fastfile"), getIosFastfile());
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Appfile"), getIosAppfile());
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Matchfile"), getIosMatchfile());
  }
  writeFileSafe(
    path.join(options.targetRoot, CONFIG_FILE),
    `${JSON.stringify(
      {
        version: 5,
        appPath: options.appPath,
        template: options.template,
        ciProvider: options.ciProvider,
        targets: options.targets,
        notifications: options.notifications
      },
      null,
      2
    )}\n`
  );
}

async function runInit() {
  const cwd = process.cwd();
  const appPath = await resolveAppPath(cwd);
  const ciProvider = await resolveCiProvider();
  const targets = await resolveTargets();
  validateAppPath(cwd, appPath, targets);
  const template = await resolveTemplate();
  const notifications = await resolveNotifications();
  const options = { appPath, targetRoot: path.join(cwd, appPath), ciProvider, template, targets, notifications };
  writeScaffold(options);
  console.log("\nSetup complete.");
  console.log(`App path: ${appPath}`);
  console.log(`CI provider: ${ciProvider}`);
  console.log(`Template: ${template}`);
  if (notifications.slack || notifications.discord || notifications.teams) {
    const channels = ["slack", "discord", "teams"].filter((channel) => notifications[channel]).join(", ");
    console.log(`Notifications: ${channels}`);
  }
  console.log("Suggested next steps:");
  console.log("1) Review generated CI files");
  console.log("2) Add secrets listed in docs/github-secrets.md");
  console.log("3) If using GitHub Actions, run rn-ci-setup secrets");
  console.log("4) Run rn-ci-setup doctor");
  console.log("5) Commit files and run a test push to main");
}

function ensureGhAvailable() {
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch (_error) {
    throw new Error("GitHub CLI (gh) is required. Install it first: https://cli.github.com/");
  }
}

function resolveGitHubRepo() {
  const fromFlag = getFlagValue("repo");
  if (fromFlag) {
    return fromFlag;
  }
  try {
    return execSync("gh repo view --json nameWithOwner -q .nameWithOwner", { encoding: "utf8" }).trim();
  } catch (_error) {
    throw new Error("Unable to detect GitHub repo. Pass it explicitly with --repo owner/name.");
  }
}

function getDoctorOptions(cwd) {
  const config =
    readJsonSafe(path.join(cwd, CONFIG_FILE)) ||
    {
      appPath: ".",
      template: "bare",
      ciProvider: "github",
      targets: { android: fs.existsSync(path.join(cwd, "android")), ios: fs.existsSync(path.join(cwd, "ios")) },
      notifications: { slack: false, discord: false, teams: false }
    };
  return {
    appPath: config.appPath,
    targetRoot: cwd,
    template: config.template,
    ciProvider: config.ciProvider || "github",
    targets: config.targets,
    notifications: config.notifications || { slack: false, discord: false, teams: false }
  };
}

async function runSecrets() {
  const cwd = process.cwd();
  const options = getDoctorOptions(cwd);
  if (options.ciProvider !== "github") {
    throw new Error("`secrets` command is only supported when ciProvider is github.");
  }

  ensureGhAvailable();
  const repo = resolveGitHubRepo();
  const checklist = getSecretsChecklist(options);
  const envProd = readEnvFile(path.join(cwd, ".env.production"));
  const envExample = readEnvFile(path.join(cwd, ".env.example"));

  const prompts = checklist.required.map((key) => ({
    type: "password",
    name: key,
    message: `Secret value for ${key}:`,
    default: envProd[key] || envExample[key] || "",
    mask: "*",
    validate: (value) => (value ? true : `${key} is required`)
  }));
  const answers = await inquirer.prompt(prompts);

  for (const key of checklist.required) {
    const value = String(answers[key] || "");
    execSync(`gh secret set ${key} --repo ${repo} --body ${JSON.stringify(value)}`, { stdio: "inherit" });
  }
  console.log(`\nUpdated ${checklist.required.length} secrets in ${repo}.`);
}

function runDoctor() {
  const cwd = process.cwd();
  const options = getDoctorOptions(cwd);
  const checklist = getSecretsChecklist(options);
  const envProd = readEnvFile(path.join(cwd, ".env.production"));
  const envExample = readEnvFile(path.join(cwd, ".env.example"));
  const missing = [];
  const weak = [];
  for (const key of checklist.required) {
    const value = process.env[key] || envProd[key] || envExample[key];
    if (!value) missing.push(key);
    else if (value.includes("example") || value === "changeme") weak.push(key);
  }
  if (missing.length === 0 && weak.length === 0) {
    console.log("Doctor check passed. Required CI/CD secrets look configured.");
    return;
  }
  if (missing.length) {
    console.error("Missing required values:");
    for (const key of missing) console.error(`- ${key}`);
  }
  if (weak.length) {
    console.error("\nLikely placeholder values detected:");
    for (const key of weak) console.error(`- ${key}`);
  }
  console.error("\nFix values in .env.production and your CI secrets, then rerun `rn-ci-setup doctor`.");
  process.exit(1);
}

function printHelp() {
  console.log(`rn-ci-setup CLI

Usage:
  rn-ci-setup init [--ci-provider <github|bitrise|codemagic>] [--android] [--ios] [--expo|--bare] [--notify-slack] [--notify-discord] [--notify-teams] [--app-path <path>]
  rn-ci-setup secrets [--repo <owner/name>]
  rn-ci-setup doctor

Examples:
  npx rn-ci-setup init --ci-provider github --android --ios --notify-slack --notify-teams
  npx rn-ci-setup init --ci-provider bitrise --android --ios
  npx rn-ci-setup init --ci-provider codemagic --ios --app-path apps/mobile
  npx rn-ci-setup secrets
  npx rn-ci-setup secrets --repo fazzysyed/rn-ci-setup
  npx rn-ci-setup doctor
`);
}

async function main() {
  const command = getArg(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "init") {
    await runInit();
    return;
  }
  if (command === "secrets") {
    await runSecrets();
    return;
  }
  if (command === "doctor") {
    runDoctor();
    return;
  }
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error("Failed to run rn-ci-setup:", error.message || error);
  process.exit(1);
});
