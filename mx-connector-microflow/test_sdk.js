const { MendixPlatformClient } = require("mendixplatformsdk");

async function main() {
  try {
    const token = "7c6RqnF2r6TJus4jhu3PLYttTRjsMEUegJRNn7q3hkkSEPy6CCDcJXT3zj5pRf2wPFS6BT4TJao942kjkpXVyfW2fB66v3AZX5Lx";
    const client = new MendixPlatformClient();
    // In SDK v5, we need to set the token via environment or some API.
    // Actually, mx-sdk-connect uses `mendixmodelsdk` or `mendixplatformsdk`?
    // Let's just run index.js directly and pipe input.
  } catch (e) {
    console.error(e);
  }
}
main();
