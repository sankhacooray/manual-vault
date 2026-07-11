/**
 * Release script — pushes source and redeploys to the SAME deployment ID so
 * the public /exec URL never changes.
 *
 * Usage: node deploy.js
 */
const { execSync } = require("child_process");

const CLASP_USER = "bsc2fast";
const DEPLOYMENT_ID =
  "AKfycbyAbXPC3dW7xTE11NTwt5yH7jXktBevWeUWUdkqw94hp7Mw8zRyW8Cui0JJSfDNw54Aew";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: __dirname });
}

try {
  run(`npx clasp --user ${CLASP_USER} push --force`);
  run(
    `npx clasp --user ${CLASP_USER} update-deployment ${DEPLOYMENT_ID} --description "Production ${new Date().toISOString()}"`
  );
  console.log(
    `\nDeployed: https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec`
  );
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
