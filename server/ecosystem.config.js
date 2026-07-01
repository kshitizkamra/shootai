module.exports = {
  apps: [{
    name: 'shootai',
    script: 'server.js',
    node_args: '--max-old-space-size=768',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
  }],
};
