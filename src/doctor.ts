import { buildRuntimeConfig } from "./config.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { ObyteMcpError } from "./errors.js";
import type { CliOptions } from "./types.js";

interface DoctorOptions {
  json: boolean;
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
}

export async function runDoctor(cliOptions: CliOptions, options: DoctorOptions): Promise<void> {
  const checks: DoctorCheck[] = [];
  let config: unknown;

  checks.push(checkNodeVersion());
  try {
    config = buildRuntimeConfig(process.env, cliOptions);
    checks.push({ name: "config", ok: true, message: "Runtime config is valid" });
  } catch (error) {
    checks.push({
      name: "config",
      ok: false,
      message: error instanceof ObyteMcpError ? error.message : String(error)
    });
  }

  const result = {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    ok: checks.every((check) => check.ok),
    checks,
    config
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${PACKAGE_NAME} ${PACKAGE_VERSION} doctor\n`);
    for (const check of checks) {
      process.stdout.write(`${check.ok ? "ok" : "fail"} ${check.name}: ${check.message}\n`);
    }
  }

  if (!result.ok) process.exitCode = 1;
}

function checkNodeVersion(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) {
    return { name: "node", ok: true, message: `Node ${process.versions.node}` };
  }
  return { name: "node", ok: false, message: `Node >=20 is required, current ${process.versions.node}` };
}
