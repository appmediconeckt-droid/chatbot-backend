import fetch from 'node-fetch';

async function run() {
  const base = 'http://localhost:3000';

  const calls = [
    {
      name: 'set-password-by-otp',
      url: `${base}/api/auth/set-password-by-otp`,
      body: { email: 'noone@example.com', password: 'NewPass123' },
    },
    {
      name: 'setPassword (no auth)',
      url: `${base}/api/auth/setPassword`,
      body: { password: 'NewPass123' },
    },
    {
      name: 'changePassword (no auth)',
      url: `${base}/api/auth/changePassword`,
      body: { oldPassword: 'x', newPassword: 'y' },
    },
  ];

  for (const c of calls) {
    try {
      const res = await fetch(c.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      });
      const text = await res.text();
      console.log('----', c.name, '----');
      console.log('STATUS:', res.status);
      console.log('BODY:', text);
    } catch (err) {
      console.error('ERR', c.name, err.message);
    }
  }
}

run();
