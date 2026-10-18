// The scanner's package entry also pulls in its Node-only stream module, so the
// extension imports the three browser-safe files it needs directly.
export { audit } from "./node_modules/safi-studio-scanner/dist/audit.js";
export { render } from "./node_modules/safi-studio-scanner/dist/report.js";
export { aggregate } from "./node_modules/safi-studio-scanner/dist/runner.js";
