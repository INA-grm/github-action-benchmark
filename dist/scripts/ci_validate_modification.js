"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const fs_1 = require("fs");
const cp = __importStar(require("child_process"));
const write_1 = require("../src/write");
const config_1 = require("../src/config");
const deep_diff_1 = require("deep-diff");
const git_1 = require("../src/git");
const assert_1 = __importDefault(require("assert"));
const deepEq = require("deep-equal");
function help() {
    throw new Error('Usage: node ci_validate_modification.js before_data.js "benchmark name" [benchmark-data-repository-directory]');
}
async function exec(cmd) {
    console.log(`+ ${cmd}`);
    return new Promise((resolve, reject) => {
        cp.exec(cmd, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`Exec '${cmd}' failed with error ${err.message}. Stderr: '${stderr}'`));
                return;
            }
            resolve(stdout);
        });
    });
}
async function readDataJson(file) {
    const content = await fs_1.promises.readFile(file, 'utf8');
    return JSON.parse(content.slice(write_1.SCRIPT_PREFIX.length));
}
function validateDataJson(data) {
    const { lastUpdate, repoUrl, entries: suites } = data;
    const now = Date.now();
    if (lastUpdate > now) {
        throw new Error(`Last update is not correct: ${lastUpdate} v.s. ${now}`);
    }
    const serverUrl = (0, git_1.getServerUrl)(repoUrl);
    const repoUrlMatcher = new RegExp(`^${serverUrl}/[^/]+/github-action-benchmark$`);
    const commitUrlMatcher = new RegExp(`^${serverUrl}/[^/]+/github-action-benchmark/commit/`);
    if (!repoUrlMatcher.test(repoUrl)) {
        throw new Error(`repoUrl is not correct: ${repoUrl}`);
    }
    for (const benchName of Object.keys(suites)) {
        for (const suite of suites[benchName]) {
            const { commit, tool, date, benches } = suite;
            if (!config_1.VALID_TOOLS.includes(tool)) {
                throw new Error(`Invalid tool ${tool}`);
            }
            if (!commitUrlMatcher.test(commit.url) && !/\/pull\/\d+\/commits\/[a-f0-9]+$/.test(commit.url)) {
                throw new Error(`Invalid commit url: ${commit.url}`);
            }
            if (!commit.url.endsWith(commit.id)) {
                throw new Error(`Commit ID ${commit.id} does not match to URL ${commit.url}`);
            }
            if (date > now) {
                throw new Error(`Benchmark date is not correct: ${date} v.s. ${now}`);
            }
            for (const bench of benches) {
                const { name, value, valueUnit, range, rangeUnit, extra } = bench;
                const json = JSON.stringify(bench);
                if (!name) {
                    throw new Error(`Benchmark result name is invalid: ${name} (${json})`);
                }
                if (typeof value !== 'number' || isNaN(value)) {
                    throw new Error(`Benchmark result value is invalid: ${value} (${json})`);
                }
                if (typeof valueUnit !== 'string') {
                    throw new Error(`Benchmark result valueUnit is invalid: ${valueUnit} (${json})`);
                }
                if (typeof range !== 'number' || isNaN(range)) {
                    throw new Error(`Benchmark result range is invalid: ${range} (${json})`);
                }
                if (rangeUnit && typeof rangeUnit !== 'string') {
                    throw new Error(`Benchmark result rangeUnit is invalid: ${rangeUnit} (${json})`);
                }
                if (extra && typeof extra !== 'string') {
                    throw new Error(`Benchmark result extra is invalid: ${extra} (${json})`);
                }
            }
        }
    }
}
function assertNumberDiffEdit(diff) {
    if (diff.kind !== 'E') {
        throw new Error(`Given diff is not DiffEdit: ${JSON.stringify(diff)}`);
    }
    if (typeof diff.lhs !== 'number') {
        throw new Error(`Given DiffEdit's lhs is not for number: ${diff.lhs}`);
    }
    if (typeof diff.rhs !== 'number') {
        throw new Error(`Given DiffEdit's rhs is not for number: ${diff.rhs}`);
    }
}
function validateLastUpdateMod(diff) {
    assertNumberDiffEdit(diff);
    if (!deepEq(diff.path, ['lastUpdate'])) {
        throw new Error(`Not diff for lastUpdate: ${JSON.stringify(diff.path)}`);
    }
    const { lhs, rhs } = diff;
    if (lhs >= rhs) {
        throw new Error(`Update of datetime is not correct. New is older: ${lhs} v.s. ${rhs}`);
    }
}
function assertDiffArray(diff) {
    if (diff.kind !== 'A') {
        throw new Error(`Given diff is not DiffArray: ${JSON.stringify(diff)}`);
    }
}
function assertDiffNewBench(diff) {
    if (diff.kind !== 'N') {
        throw new Error(`Given diff is not DiffNew: ${JSON.stringify(diff)}`);
    }
    const { rhs } = diff;
    if (typeof rhs !== 'object' || rhs === null) {
        throw new Error(`DiffNew for Benchmark object is actually not a object: ${rhs}`);
    }
    for (const prop of ['commit', 'date', 'tool', 'benches']) {
        if (!(prop in rhs)) {
            throw new Error(`Not a valid benchmark object in DiffNew: ${JSON.stringify(rhs)}`);
        }
    }
}
function validateBenchmarkResultMod(diff, expectedBenchName, afterSuites) {
    if (!(expectedBenchName in afterSuites)) {
        throw new Error(`data.js after action does not contain '${expectedBenchName}' benchmark`);
    }
    const benchSuites = afterSuites[expectedBenchName];
    if (benchSuites.length === 0) {
        throw new Error('Benchmark suite is empty after action');
    }
    if (diff.kind === 'N') {
        // Previous data does not exist. This case occurs only once when new tool support is added.
        // Ignore checks.
        return;
    }
    assertDiffArray(diff);
    if (!deepEq(diff.path, ['entries', expectedBenchName])) {
        throw new Error(`Diff path is not expected for adding new benchmark: ${JSON.stringify(diff.path)}`);
    }
    diff = diff.item;
    assertDiffNewBench(diff);
    const added = diff.rhs;
    const last = benchSuites[benchSuites.length - 1];
    if (last.commit.id !== added.commit.id) {
        throw new Error(`Newly added benchmark ${JSON.stringify(added)} is not the last one in data.js ${JSON.stringify(last)}`);
    }
    for (const suite of benchSuites) {
        if (suite.date > added.date) {
            throw new Error(`Older suite's date ${JSON.stringify(suite)} is newer than added ${JSON.stringify(added)}`);
        }
        if (suite.tool !== added.tool) {
            throw new Error(`Tool is different between ${JSON.stringify(suite)} and ${JSON.stringify(added)}`);
        }
        for (const addedBench of added.benches) {
            for (const prevBench of suite.benches) {
                if (prevBench.name === addedBench.name) {
                    if (prevBench.valueUnit !== addedBench.valueUnit) {
                        throw new Error(`Unit is different between previous benchmark and newly added benchmark: ${JSON.stringify(prevBench)} v.v. ${JSON.stringify(addedBench)}`);
                    }
                }
            }
        }
    }
}
function validateDiff(beforeJson, afterJson, expectedBenchName) {
    const diffs = (0, deep_diff_1.diff)(beforeJson, afterJson);
    console.log('Validating diffs:', diffs);
    if (!diffs || diffs.length !== 2) {
        throw new Error('Number of diffs are incorrect. Exact 2 diffs are expected');
    }
    console.log('Validating lastUpdate modification');
    validateLastUpdateMod(diffs[0]);
    console.log('Validating benchmark result modification');
    validateBenchmarkResultMod(diffs[1], expectedBenchName, afterJson.entries);
    console.log('👌');
}
async function main() {
    console.log('Start validating modifications by action with args', process.argv);
    if (process.argv.length !== 4 && process.argv.length !== 5) {
        help();
    }
    if (['-h', '--help'].includes(process.argv[2])) {
        help();
    }
    console.log('Checking pre-condition');
    const stats = await fs_1.promises.stat(path.resolve('.git'));
    if (!stats.isDirectory()) {
        throw new Error('This script must be run at root directory of repository');
    }
    const beforeDataJs = path.resolve(process.argv[2]);
    const expectedBenchName = process.argv[3];
    const benchmarkDataDirectory = process.argv[4];
    const additionalGitParams = benchmarkDataDirectory
        ? `--work-tree=${benchmarkDataDirectory} --git-dir=${benchmarkDataDirectory}/.git`
        : '';
    console.log('Validating modifications by action');
    console.log(`  data.js before action: ${beforeDataJs}`);
    console.log('Reading data.js before action as JSON');
    const beforeJson = await readDataJson(beforeDataJs);
    console.log('Validating current branch');
    const branch = await exec(`git ${additionalGitParams} rev-parse --abbrev-ref HEAD`);
    if (branch === 'gh-pages') {
        throw new Error(`Current branch is still on '${branch}'`);
    }
    console.log('Retrieving data.js after action');
    await exec(`git ${additionalGitParams} checkout gh-pages`);
    const latestCommitLog = await exec(`git ${additionalGitParams} log -n 1`);
    console.log('Validating auto commit');
    const commitLogLines = latestCommitLog.split('\n');
    const commitAuthorLine = commitLogLines[1];
    if (!commitAuthorLine.startsWith('Author: github-action-benchmark')) {
        throw new Error(`Unexpected auto commit author in log '${latestCommitLog}'`);
    }
    const commitMessageLine = commitLogLines[4];
    const reCommitMessage = new RegExp(`add ${expectedBenchName.replace(/[.*+?^=!:${}()|[\]/\\]/g, '\\$&')} \\([^)]+\\) benchmark result for [0-9a-f]+$`);
    if (!reCommitMessage.test(commitMessageLine)) {
        throw new Error(`Unexpected auto commit message in log '${latestCommitLog}'`);
    }
    const dataResults = await Promise.allSettled([
        readDataJson('benchmark-data-repository/dev/bench/data.js'),
        readDataJson('dev/bench/data.js'),
    ]);
    const jsonResults = dataResults
        .filter((res) => res.status === 'fulfilled')
        .map((res) => res.value);
    (0, assert_1.default)(jsonResults.length > 0 && jsonResults.length <= 2, 'Maximum 2 data.js files should be present in the repo');
    const afterJson = jsonResults[0];
    await exec(`git ${additionalGitParams} checkout -`);
    console.log('Validating data.js both before/after action');
    validateDataJson(beforeJson);
    validateDataJson(afterJson);
    validateDiff(beforeJson, afterJson, expectedBenchName);
}
main().catch((err) => {
    console.error(err);
    process.exit(110);
});
//# sourceMappingURL=ci_validate_modification.js.map