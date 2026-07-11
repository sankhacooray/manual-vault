/**
 * Pulls the latest source from the Apps Script web IDE (if it was edited
 * there) into ./src. Commit local work before running — pull does not merge.
 *
 * Usage: node fetch.js
 */
const { execSync } = require("child_process");

const CLASP_USER = "bsc2fast";

execSync(`npx clasp --user ${CLASP_USER} pull`, {
  stdio: "inherit",
  cwd: __dirname,
});
