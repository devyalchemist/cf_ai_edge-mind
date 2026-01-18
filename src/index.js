import { DurableObject } from 'cloudflare:workers';

// ==========================================
// 1. THE FRONTEND (Served directly from Edge)
// ==========================================
const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cloudflare Edge AI (Auth)</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f4f4f5; }
  
  /* Chat UI */
  .chat-container { height: 60vh; overflow-y: scroll; background: white; padding: 20px; border-radius: 12px; border: 1px solid #ccc; display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
  .message { padding: 10px 15px; border-radius: 15px; max-width: 85%; line-height: 1.5; }
  .user { align-self: flex-end; background: #0070f3; color: white; }
  .ai { align-self: flex-start; background: #e5e5e5; color: black; border: 1px solid #d1d1d1; }
  
  /* Inputs */
  .input-group { display: flex; gap: 10px; }
  input { flex: 1; padding: 12px; border: 1px solid #ccc; border-radius: 6px; }
  button { padding: 12px 20px; background: #0070f3; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }

  /* Login Overlay (The "Simulated Auth") */
  #login-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.95); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .login-box { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); border: 1px solid #ddd; text-align: center; width: 80%; max-width: 300px; }
</style>
</head>
<body>

  <div id="login-overlay">
    <div class="login-box">
      <h2>Who are you?</h2>
      <p style="color: #666; font-size: 0.9rem; margin-bottom: 20px;">Enter a unique handle to access your persistent memory.</p>
      <form id="login-form">
        <input type="text" id="username-input" placeholder="e.g. devyalchemist" required />
        <br><br>
        <button type="submit" style="width: 100%">Enter Chat</button>
      </form>
    </div>
  </div>

  <div id="app-ui" style="display:none;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <h2>EdgeMind</h2>
      <small id="user-display" style="color:#666;"></small>
    </div>
    
    <div id="chat-box" class="chat-container"></div>
    
    <form id="chat-form" class="input-group">
      <input type="text" id="msg-input" placeholder="Type a message..." required autocomplete="off"/>
      <button type="submit">Send</button>
    </form>
    
    <button onclick="logout()" style="margin-top:20px; background: #ccc; color: #333; font-size: 0.8rem; width: 100%;">Logout / Switch User</button>
  </div>

  <script>
    const loginOverlay = document.getElementById('login-overlay');
    const appUI = document.getElementById('app-ui');
    const chatBox = document.getElementById('chat-box');
    
    // 1. Check if user is already "logged in"
    let sessionId = localStorage.getItem('edge_username');

    if (sessionId) {
      showChat(sessionId);
    }

    // 2. Handle Login
    document.getElementById('login-form').onsubmit = (e) => {
      e.preventDefault();
      const username = document.getElementById('username-input').value.trim().toLowerCase();
      if (!username) return;
      
      // Save identity
      localStorage.setItem('edge_username', username);
      sessionId = username;
      showChat(username);
    };

    function showChat(name) {
      loginOverlay.style.display = 'none';
      appUI.style.display = 'block';
      document.getElementById('user-display').innerText = 'User: ' + name;
      // Load previous messages (optional visual trick, real history is on server)
      addMessage("Connected to memory vault: " + name, "ai");
    }

    // 3. Handle Chat
    document.getElementById('chat-form').onsubmit = async (e) => {
      e.preventDefault();
      const text = document.getElementById('msg-input').value;
      addMessage(text, 'user');
      document.getElementById('msg-input').value = '';

      try {
        // VITAL: We use the 'username' as the sessionId
        const res = await fetch(\`/?sessionId=\${sessionId}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        if (data.error) addMessage("Error: " + data.error, 'error');
        else addMessage(data.response, 'ai');
      } catch (err) {
        addMessage("Network Error", 'error');
      }
    };

    function addMessage(text, type) {
      const div = document.createElement('div');
      div.className = \`message \${type}\`;
      div.innerText = text;
      chatBox.appendChild(div);
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    function logout() {
      localStorage.removeItem('edge_username');
      location.reload();
    }
  </script>
</body>
</html>
`;

// ==========================================
// 2. THE BACKEND (Durable Object with Error Catching)
// ==========================================
export class ChatRoom extends DurableObject {
	constructor(state, env) {
		super(state, env);
		this.state = state;
		this.env = env;
	}

	async fetch(request) {
		let history = (await this.state.storage.get('history')) || [];
		const { message } = await request.json();
		history.push({ role: 'user', content: message });

		// Trim history to prevent overflow
		const context = history.slice(-6);

		try {
			// DEBUG: We are using the 8B model because it is safer for Free Tier
			const model = '@cf/meta/llama-3.1-8b-instruct';

			const response = await this.env.AI.run(model, {
				messages: [{ role: 'system', content: 'You are a helpful assistant.' }, ...context],
			});

			// CHECK: Did the AI actually reply?
			if (!response || !response.response) {
				throw new Error('AI returned empty result. Model might be busy.');
			}

			const aiMessage = response.response;
			history.push({ role: 'assistant', content: aiMessage });
			await this.state.storage.put('history', history);

			return new Response(JSON.stringify({ response: aiMessage }), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (err) {
			// CRITICAL: We send the error back to the user so we can see it!
			return new Response(
				JSON.stringify({
					response: 'Error',
					error: err.message,
				}),
				{
					headers: { 'Content-Type': 'application/json' }, // Return 200 so frontend can parse the error JSON
				},
			);
		}
	}
}

// ==========================================
// 3. THE ROUTER
// ==========================================
export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (request.method === 'GET') {
			return new Response(html, { headers: { 'Content-Type': 'text/html' } });
		}

		if (request.method === 'POST') {
			const sessionId = url.searchParams.get('sessionId');
			if (!sessionId) return new Response('Missing sessionId', { status: 400 });

			const id = env.CHAT_HISTORY.idFromName(sessionId);
			const stub = env.CHAT_HISTORY.get(id);
			return stub.fetch(request);
		}

		return new Response('Not Found', { status: 404 });
	},
};
