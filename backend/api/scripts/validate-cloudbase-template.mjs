#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLOUDBASE_ENV_ID_PLACEHOLDER = "__REPLACE_WITH_CLOUDBASE_ENV_ID__";
export const CLOUDBASE_TEMPLATE_RELATIVE_PATH = "infra/cloudbase/cloudbaserc.voice-ready.template.json";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const defaultCloudBaseTemplatePath = resolve(SCRIPT_DIRECTORY, "../../../", CLOUDBASE_TEMPLATE_RELATIVE_PATH);
const SECRET_FIELD = /(secret|password|private[_-]?key|token|credential|access[_-]?key|api[_-]?key)/i;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readTemplate(path, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    errors.push(String(path) + " must be valid, readable JSON");
    return null;
  }
}

function checkEqual(errors, value, expected, label) {
  if (value !== expected) {
    errors.push(String(label) + " must be " + JSON.stringify(expected));
  }
}

function reportSecretLookingFields(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => reportSecretLookingFields(entry, path + "[" + index + "]", errors));
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  for (const [key, entry] of Object.entries(record)) {
    const fieldPath = path ? path + "." + key : key;
    if (SECRET_FIELD.test(key)) {
      errors.push(fieldPath + " must not be stored in the reviewed CloudBase template");
    }
    reportSecretLookingFields(entry, fieldPath, errors);
  }
}

/**
 * This validates the source-controlled template only. It deliberately refuses
 * live environment IDs and runtime variables: the real CloudBase manifest is
 * generated outside the repository by the approved deployment path.
 */
export function validateCloudBaseTemplate(templatePath = defaultCloudBaseTemplatePath) {
  const resolvedPath = resolve(templatePath);
  const errors = [];
  const template = asRecord(readTemplate(resolvedPath, errors));
  if (!template) return errors;

  checkEqual(errors, template.envId, CLOUDBASE_ENV_ID_PLACEHOLDER, resolvedPath + ".envId");

  const framework = asRecord(template.framework);
  const plugins = asRecord(framework?.plugins);
  const plugin = asRecord(plugins?.["talk-and-talk-api"]);
  const inputs = asRecord(plugin?.inputs);
  if (!framework || !plugins || !plugin || !inputs) {
    errors.push(resolvedPath + " must define framework.plugins.talk-and-talk-api.inputs");
    return errors;
  }

  checkEqual(errors, plugin.use, "@cloudbase/framework-plugin-container", "CloudBase container plugin");
  checkEqual(errors, inputs.serviceName, "talk-and-talk-api", "CloudBase serviceName");
  checkEqual(errors, inputs.servicePath, "/", "CloudBase servicePath");
  checkEqual(errors, inputs.localPath, "./backend/api", "CloudBase localPath");
  checkEqual(errors, inputs.mode, "high-availability", "CloudBase mode");
  checkEqual(errors, inputs.cpu, 1, "CloudBase cpu");
  checkEqual(errors, inputs.mem, 2, "CloudBase mem");
  checkEqual(errors, inputs.policyType, "cpu", "CloudBase policyType");
  checkEqual(errors, inputs.policyThreshold, 60, "CloudBase policyThreshold");
  checkEqual(errors, inputs.containerPort, 3000, "CloudBase containerPort");
  checkEqual(errors, inputs.dockerfilePath, "./Dockerfile", "CloudBase dockerfilePath");
  checkEqual(errors, inputs.buildDir, "./", "CloudBase buildDir");

  if (template.PRIVATE_INGRESS_REQUIRED !== true) {
    errors.push(
      "CloudBase template must set PRIVATE_INGRESS_REQUIRED=true because servicePath=/ serves /admin and /review"
    );
  }

  if (!Number.isInteger(inputs.minNum) || inputs.minNum < 1) {
    errors.push("CloudBase minNum must be an integer of at least 1 while real-time voice is enabled");
  }
  if (!Number.isInteger(inputs.maxNum) || inputs.maxNum < inputs.minNum) {
    errors.push("CloudBase maxNum must be an integer no lower than minNum");
  }
  if (Object.hasOwn(inputs, "envVariables")) {
    errors.push(
      "CloudBase template must omit envVariables; configure encrypted runtime variables outside the repository"
    );
  }

  reportSecretLookingFields(template, "", errors);
  return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const errors = validateCloudBaseTemplate();
  if (errors.length) {
    console.error("CloudBase deployment template gate failed with " + errors.length + " issue(s):");
    for (const error of errors) console.error("- " + error);
    process.exitCode = 1;
  } else {
    console.log(
      "CloudBase deployment template gate passed: voice-ready service capacity and credential-free source template are valid."
    );
  }
}
