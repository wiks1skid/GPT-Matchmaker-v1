const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const axios = require('axios');

const app = express();
const expressServer = http.createServer(app);
const wsServer = http.createServer();
const wss = new WebSocket.Server({ server: wsServer });

let isGameServerReady = false;
let isBackendReady = false;

let gameServerStatus = 'Not Detected (Probably OFF)';
let backendStatus = 'OFF'; // Initialize backend status as OFF

const PORT_EXPRESS = 665;
expressServer.listen(PORT_EXPRESS, () => {
  logWithTimestamp(`(NAME) Status: Matchmaker is Online!!!`);
  checkBackendStatus();
});

const PORT_WS = 81;
wsServer.listen(PORT_WS, () => {
  logWithTimestamp(`WebSocket server started on port ${PORT_WS}`);
});

wss.on('connection', (ws) => {
  logWithTimestamp('Client connected');

  ws.on('message', (message) => {
    logWithTimestamp(`Received: ${message}`);
    const { action, data } = JSON.parse(message);

    switch (action) {
      case 'match':
        handleMatch(ws, data);
        break;
      default:
        logWithTimestamp('Invalid action');
    }
  });

  ws.on('close', () => {
    logWithTimestamp('Client disconnected');
  });
});

async function handleMatch(ws, data) {
  const { email } = data;

  if (await isUserBanned(email)) {
    ws.send(JSON.stringify({ action: 'banned', message: 'You are banned!' }));
    return;
  }

  queue.push(ws);
  logWithTimestamp(`Player added to the queue`);

  if (isGameServerReady) {
    const player = queue.shift();
    const sessionId = crypto.createHash('md5').update(`3${Date.now()}`).digest('hex');

    player.send(JSON.stringify({
      payload: {
        matchId: sessionId,
        state: 'SessionAssignment'
      },
      name: 'StatusUpdate'
    }));
    logWithTimestamp(`Player assigned to session ${sessionId}`);
  }
}

async function isUserBanned(email) {
  try {
    const client = new MongoClient('mongodb://127.0.0.1/gptbanned');
    await client.connect();
    const db = client.db('fortban');
    const collection = db.collection('bannedUsers');
    const query = { email };
    const user = await collection.findOne(query);
    client.close();
    return user !== null;
  } catch (error) {
    console.error('Error checking banned status:', error);
    return false;
  }
}

async function handleBan(email) {
  try {
    const client = new MongoClient('mongodb://127.0.0.1/(URL)');
    await client.connect();
    const db = client.db('nexus');
    const collection = db.collection('users');
    const query = { email };
    const updateDocument = {
      $set: { banned: true }
    };
    const result = await collection.updateOne(query, updateDocument);
    if (result.modifiedCount > 0) {
      await storeBannedUser(email);
      logWithTimestamp(`Email ${email} banned.`);
      sendDiscordMessage(`User ${email} has been banned.`);
    } else {
      logWithTimestamp(`Email ${email} not found.`);
    }
    client.close();
  } catch (error) {
    console.error('Error banning email:', error);
  }
}

async function storeBannedUser(email) {
  try {
    const client = new MongoClient('mongodb://127.0.0.1/gptbanned');
    await client.connect();
    const db = client.db('fortban');
    const collection = db.collection('bannedUsers');
    const result = await collection.insertOne({ email });
    if (result.insertedCount > 0) {
      logWithTimestamp(`User ${email} added to the banned list.`);
    } else {
      logWithTimestamp(`Failed to add ${email} to the banned list.`);
    }
    client.close();
  } catch (error) {
    console.error('Error storing banned user:', error);
  }
}

async function handleUnban(email) {
  try {
    const client = new MongoClient('mongodb://127.0.0.1/(URL)');
    await client.connect();
    const db = client.db('nexus');
    const collection = db.collection('users');
    const query = { email };
    const updateDocument = {
      $set: { banned: false }
    };
    const result = await collection.updateOne(query, updateDocument);
    if (result.modifiedCount > 0) {
      await removeBannedUser(email);
      logWithTimestamp(`Email ${email} unbanned.`);
      sendDiscordMessage(`User ${email} has been unbanned.`);
    } else {
      logWithTimestamp(`Email ${email} not found or already unbanned.`);
    }
    client.close();
  } catch (error) {
    console.error('Error unbanning email:', error);
  }
}

async function removeBannedUser(email) {
  try {
    const client = new MongoClient('mongodb://127.0.0.1/gptbanned');
    await client.connect();
    const db = client.db('fortban');
    const collection = db.collection('bannedUsers');
    const result = await collection.deleteOne({ email });
    if (result.deletedCount > 0) {
      logWithTimestamp(`User ${email} removed from the banned list.`);
    } else {
      logWithTimestamp(`Failed to remove ${email} from the banned list.`);
    }
    client.close();
  } catch (error) {
    console.error('Error removing banned user:', error);
  }
}

const checkGameServerStatus = async () => {
  const serverReady = await isPortInUse(7777);
  logAndNotifyStatusChange('Gameserver', isGameServerReady, serverReady);
  isGameServerReady = serverReady;
};

const checkBackendStatus = async () => {
  const serverReady = await isPortInUse(3551);
  logAndNotifyStatusChange('Backend', isBackendReady, serverReady);
  isBackendReady = serverReady;
};

async function isPortInUse(port) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const tester = net.createServer()
      .once('error', (err) => {
        if (err.code !== 'EADDRINUSE') return resolve(false);
        resolve(true);
      })
      .once('listening', () => {
        tester.once('close', () => resolve(false)).close();
      })
      .listen(port);
  });
}

app.get('/', (req, res) => {
  res.send(`(NAME) Status:<br>Matchmaker is Online!!!<br>Backend is ${backendStatus}<br>Gameserver is ${gameServerStatus}`);
});

const logWithTimestamp = (message) => {
  console.log(message);
};

const logAndNotifyStatusChange = (component, prevStatus, newStatus) => {
  if (prevStatus !== newStatus) {
    logWithTimestamp(`${component} is ${newStatus ? 'ON' : 'OFF'}`);
    sendDiscordMessage(`${component} is ${newStatus ? 'ON' : 'OFF'}`);
  }
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', (input) => {
  const command = input.trim().toLowerCase();

  if (command.startsWith('ban')) {
    const email = command.substring(4).trim();
    handleBan(email);
  } else if (command.startsWith('unban')) {
    const email = command.substring(6).trim();
    handleUnban(email);
  } else {
    console.log('Invalid command. Use "ban email" to ban someone or "unban email" to unban someone.');
  }
});

process.on('exit', () => {
  const logMessage = getLogContent();
  fs.writeFileSync(getLogFileName(), logMessage);
  console.log('Application exited');
});

const getLogFileName = () => {
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace('T', '_').replace(/\..*/, '');
  return path.join(__dirname, `log_${timestamp}.txt`);
};

const getLogContent = () => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] Application exited\n`;
};

setInterval(checkGameServerStatus, 5);
setInterval(checkBackendStatus, 5);

const sendDiscordMessage = async (message) => {
  try {
    const webhookURL = '(WEBHOOK)';
    await axios.post(webhookURL, { content: message });
  } catch (error) {
    console.error('Error sending Discord message:', error.message);
  }
};
