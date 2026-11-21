module.exports = {
  apps: [
    {
      name: 'bpmn-forge-web',
      script: 'serve',
      env: {
        PM2_SERVE_HOST: '127.0.0.1',
        PM2_SERVE_PORT: '41283',
        PM2_SERVE_PATH: '/var/lib/bpmn-forge/current',
      },
    },
  ],
};
