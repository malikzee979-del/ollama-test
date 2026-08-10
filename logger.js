// Tiny leveled logger. No external dependency — just structured,
// timestamped, single-line entries to stdout/stderr. Deliberately dumb:
// this project's philosophy is "thin proxy, minimal deps", so this isn't
// trying to be winston/pino, just enough structure to grep/parse logs.

function timestamp() {
  return new Date().toISOString();
}

function format(level, args) {
  const message = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  return `[${timestamp()}] ${level} ${message}`;
}

function info(...args) {
  console.log(format('INFO', args));
}

function warn(...args) {
  console.warn(format('WARN', args));
}

function error(...args) {
  console.error(format('ERROR', args));
}

module.exports = { info, warn, error };
