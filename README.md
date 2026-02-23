# LiveCodeApp

A Node.js based live code sharing application with zero external dependencies — built purely with Node's built-in http, net, and crypto modules.
Features

🔴 Live code sync — changes broadcast to all room participants in real-time.

👥 Multi-user rooms — create or join rooms with shareable 6-character codes.

💬 Integrated chat — talk with collaborators without leaving the editor.

▶ In-browser JS execution — run JavaScript directly with console output.

🎨 Syntax-aware tabs — supports JS, TS, Python, HTML, CSS, JSON, Bash.

🧑‍🤝‍🧑 User presence — see who's in the room with color-coded avatars.

⌨ Typing indicators — know when someone is editing.

    How It Works
Enter a name on the landing screen
Create a Room to get a 6-character room code
Share the code with collaborators — they paste it and click Join
Code together — all edits sync instantly via WebSockets

    Message Types
TypeDirectionDescriptioncreate_roomC→SCreate a new 

roomjoin_roomC→SJoin by room 

coderoom_joinedS→CConfirmation + initial 

statecode_changeC→SBroadcast code 

updatecode_updateS→CReceive code 

updatelanguage_changeC→SChange syntax 

languagechatC→SSend chat messagechat_messageS→CReceive 

chat messageuser_joined/leftS→CPresence events