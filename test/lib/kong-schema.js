// Validate generated plugin entities against Kong Admin API schema snapshots (test/fixtures/schemas/<target>/).
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../fixtures/schemas");
const cache = {};
function schema(target, plugin) {
  const k = `${target}/${plugin}`;
  if (!(k in cache)) {
    const f = path.join(DIR, target, `${plugin}.json`);
    cache[k] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  }
  return cache[k];
}
const fieldMap = list => Object.assign({}, ...(list || []));
const topField = (sch, name) => fieldMap(sch.fields)[name];
const isPlaceholder = v => typeof v === "string" && /^<.*>$|\{vault:\/\//.test(v);

function checkValue(v, def, p, errs) {
  if (v === null || v === undefined || !def) return;
  switch (def.type) {
    case "string":
      if (typeof v !== "string") errs.push(`${p}: expected string, got ${typeof v}`);
      else if (def.one_of && !def.one_of.includes(v) && !isPlaceholder(v)) errs.push(`${p}: "${v}" not in ${JSON.stringify(def.one_of)}`);
      break;
    case "number": if (typeof v !== "number") errs.push(`${p}: expected number`); break;
    case "integer": if (!Number.isInteger(v)) errs.push(`${p}: expected integer`); break;
    case "boolean": if (typeof v !== "boolean") errs.push(`${p}: expected boolean`); break;
    case "array": case "set":
      if (!Array.isArray(v)) { errs.push(`${p}: expected array`); break; }
      v.forEach((el, i) => checkValue(el, def.elements, `${p}[${i}]`, errs));
      break;
    case "map":
      if (typeof v !== "object" || Array.isArray(v)) { errs.push(`${p}: expected map`); break; }
      for (const [k, x] of Object.entries(v)) checkValue(x, def.values, `${p}.${k}`, errs);
      break;
    case "record": checkRecord(v, def, p, errs); break;
    default: break; // foreign, json, any: accepted
  }
}
function checkRecord(v, def, p, errs) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) { errs.push(`${p}: expected record`); return; }
  const defs = fieldMap(def.fields), short = fieldMap(def.shorthand_fields);
  for (const [k, x] of Object.entries(v)) {
    const d = defs[k] || short[k];
    if (!d) { errs.push(`${p}.${k}: unknown field`); continue; }
    checkValue(x, d, `${p}.${k}`, errs);
  }
}

const ENTITY_KEYS_DECK = new Set(["name", "config", "condition", "expressions", "enabled", "protocols", "tags",
  "instance_name", "ordering", "route", "service", "consumer", "consumer_group"]);

/** Validate a decK-style plugin object. target: gw-3.16 | gw-3.15 | aigw-2.2 */
function checkPlugin(plugin, target, where) {
  const errs = [];
  const sch = schema(target, plugin.name);
  if (!sch) return [`${where}: no schema snapshot for plugin "${plugin.name}" in ${target}`];
  const entity = JSON.parse(fs.readFileSync(path.join(DIR, target, "_plugin-entity.json"), "utf8"));
  const entityFields = fieldMap(entity.fields);
  for (const k of Object.keys(plugin)) {
    if (!ENTITY_KEYS_DECK.has(k)) errs.push(`${where}.${k}: not a plugin entity key`);
    else if (!["name", "config"].includes(k) && !entityFields[k]) errs.push(`${where}.${k}: plugin entity field not supported in ${target}`);
  }
  checkRecord(plugin.config || {}, topField(sch, "config"), `${where}(${plugin.name}).config`, errs);
  if (plugin.expressions) {
    const ex = topField(sch, "expressions");
    if (!ex) errs.push(`${where}(${plugin.name}).expressions: plugin has no expressible fields in ${target}`);
    else checkRecord(plugin.expressions, ex, `${where}(${plugin.name}).expressions`, errs);
  }
  return errs;
}

/** Validate a bare config object (AI Gateway 2.x auth strategy or policy config). */
function checkConfig(pluginName, config, target, where) {
  const sch = schema(target, pluginName);
  if (!sch) return [`${where}: no schema snapshot for "${pluginName}" in ${target}`];
  const errs = [];
  checkRecord(config || {}, topField(sch, "config"), `${where}(${pluginName})`, errs);
  return errs;
}

module.exports = { checkPlugin, checkConfig, schema };
