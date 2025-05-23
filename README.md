# Discord AI Bot with Gemini API

A Discord bot that uses the Google Gemini API to provide intelligent responses to user queries, with support for conversation history and multiple personalities.

## Features

- Responds to messages starting with `!ai <your query>`.
- Powered by Google's Gemini Pro model.

### Conversation History
- The bot remembers a configurable number of past messages per user for contextual responses.
- This history length is defined by `MAX_HISTORY_MESSAGES` in `config.py`.
- Use the `!clearhistory` command to clear your personal conversation history with the bot for the current session.

### Multiple Personalities
- The bot can adopt different personalities, each with a unique system prompt.
- Personalities are defined in the `AVAILABLE_PERSONALITIES` dictionary in `config.py`.
- Commands to manage personalities:
    - `!setpersonality <name>`: Sets the bot's personality for you. (Clears current session history).
    - `!getpersonality`: Shows your currently active personality.
    - `!listpersonalities`: Lists all available personalities.

## Commands

Here's a list of commands you can use with the bot:

-   `!ai <query>`: Sends your query to the AI, taking into account your current conversation history and personality.
-   `!clearhistory`: Clears your personal conversation history with the bot for the current session (personality remains).
-   `!listpersonalities`: Lists all available personalities you can set.
-   `!setpersonality <name>`: Sets the bot's personality for you (e.g., `!setpersonality comedian`). This will also clear your current conversation history to ensure a fresh start with the new persona.
-   `!getpersonality`: Shows the name and a snippet of the description for your currently active personality.

## Setup Instructions

### 1. Clone the Repository
```bash
git clone <repository_url> # Replace <repository_url> with the actual URL
cd <repository_directory>
```

### 2. Create and Activate a Virtual Environment (Recommended)
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
```

### 3. Install Dependencies
Make sure you have Python 3.8+ installed.
```bash
pip install -r requirements.txt
```

### 4. Configuration

You need to provide your Discord Bot Token and Gemini API Key. You can also configure conversation history and personalities.

**Option 1: Using `config.py` (Recommended for local development)**

1.  It's recommended to copy `config.py.example` to `config.py` if it exists and you haven't configured before. If you have an existing `config.py`, ensure it includes the new variables. The file should look like this:
    ```python
    # config.py

    # Discord Bot Token
    # Go to the Discord Developer Portal (https://discord.com/developers/applications)
    # 1. Create a New Application.
    # 2. Go to the "Bot" tab.
    # 3. Click "Add Bot" and confirm.
    # 4. Under "Token", click "Copy". This is your DISCORD_TOKEN.
    # 5. Make sure to enable "Message Content Intent" under "Privileged Gateway Intents".
    DISCORD_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"

    # Gemini API Key
    # Go to Google AI Studio (https://aistudio.google.com/)
    # 1. Click on "Get API key".
    # 2. Either create a new project or use an existing one.
    # 3. Click "Create API key". This is your GEMINI_API_KEY.
    GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE"

    # Maximum number of messages (user + bot) to keep in conversation history per user.
    # A value of 10 means roughly 5 turns of conversation (1 user + 1 bot = 2 messages per turn).
    MAX_HISTORY_MESSAGES = 10

    # Personalities for the bot
    # Each key is a name for the personality (used in !setpersonality command), 
    # and the value is the system prompt that guides the AI's behavior.
    AVAILABLE_PERSONALITIES = {
        "default": "You are a helpful and friendly AI assistant. Respond clearly and concisely.",
        "comedian": "You are a witty comedian. Your main goal is to make the user laugh with every response, while still trying to be somewhat helpful if a question is asked.",
        "coder": "You are an expert Python programmer. Provide clear, concise, and correct code examples. Explain the code unless asked not to. Assume the user is an intermediate Python developer.",
        "storyteller": "You are a master storyteller. Weave engaging narratives and try to respond in a story-like format."
    }
    # The key from AVAILABLE_PERSONALITIES to use by default for new users.
    DEFAULT_PERSONALITY = "default" 
    ```
2.  Replace `"YOUR_DISCORD_BOT_TOKEN_HERE"` and `"YOUR_GEMINI_API_KEY_HERE"` with your actual token and key.
3.  Adjust `MAX_HISTORY_MESSAGES`, `AVAILABLE_PERSONALITIES`, and `DEFAULT_PERSONALITY` as desired.
4.  **Important**: The `.gitignore` file is already configured to ignore `config.py`, so you won't accidentally commit your secret keys.

**Option 2: Using Environment Variables**

Set the following environment variables:
- `DISCORD_TOKEN`: Your Discord bot token.
- `GEMINI_API_KEY`: Your Gemini API key.
- `MAX_HISTORY_MESSAGES` (optional, defaults to 10 in `bot.py` if not set)
- `DEFAULT_PERSONALITY` (optional, defaults to "default" in `bot.py` if not set)
- Note: `AVAILABLE_PERSONALITIES` is complex and best configured via `config.py`. The bot will use a very basic default personality if `config.py` and this variable are missing.

The `bot.py` script will automatically try to load these from `config.py` first, then fall back to environment variables for some settings if not found in the file.

### 5. Invite Your Bot to Your Server
1. Go to your application in the Discord Developer Portal.
2. Go to the "OAuth2" tab, then "URL Generator".
3. Select the `bot` scope.
4. In "Bot Permissions", select "Read Messages/View Channels" and "Send Messages". You might need "Read Message History" as well for the bot to see previous messages if it restarts and history is not persistent.
5. Copy the generated URL and open it in your browser to invite the bot to your server.

## Running the Bot

Once you have completed the setup and configuration:
```bash
python bot.py
```
The bot should log in and print a confirmation message to your console. You can then test it in your Discord server using the commands listed above.
