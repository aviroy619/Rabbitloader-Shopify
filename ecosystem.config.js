module.exports = {
  apps: [{
    name: "rl-shopify",
    script: "app.js",
    cwd: "/apps/rl-shopify",
    interpreter: "/usr/bin/node",
    disable_trace: true,
    env: {
      NODE_ENV: "production"
    }
  }]
};
