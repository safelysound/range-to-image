// web-ext configuration.
//
// Keep dev-only / repo-only files out of the published .zip/.xpi. web-ext
// already excludes dotfiles (.git, .gitignore, .claude), node_modules, and
// web-ext-artifacts/, but NOT regular files like these — so list them
// explicitly. The result is a minimal package: manifest.json, content.js,
// content.css, and icons/.
module.exports = {
  ignoreFiles: ["PUBLISHING.md", "PRIVACY.md", "README.md", "LICENSE", "web-ext-config.cjs"],
};
