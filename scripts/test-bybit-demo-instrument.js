#!/usr/bin/env node
const axios = require('axios');
(async () => {
  const response = await axios.get('https://api-demo.bybit.com/v5/market/instruments-info?category=linear&symbol=BTCUSDT');
  console.log(JSON.stringify(response.data, null, 2));
})();
