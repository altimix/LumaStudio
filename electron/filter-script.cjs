const fs = require('node:fs/promises');
const path = require('node:path');

// Keep automation curves out of Windows' command-line length limit.
async function writeFilterScript(args, directory) {
  const index = args.indexOf('-filter_complex');
  if (index < 0) return args;
  const file = path.join(directory, 'filters.txt');
  await fs.writeFile(file, args[index + 1], 'utf8');
  const next = [...args]; next.splice(index, 2, '-filter_complex_script', file);
  return next;
}
module.exports = { writeFilterScript };
