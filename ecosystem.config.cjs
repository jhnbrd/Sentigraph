module.exports = {
  apps: [
    {
      name: 'sentigraph',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '50M',
      env: {
        NODE_ENV: 'production',
        PORT: 8072,
        PUBLIC_ORIGIN: 'https://sentigraph.jhnbrd.com'
      }
    }
  ]
};
