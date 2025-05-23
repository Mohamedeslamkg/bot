# Discord AI Bot with Gemini API

A Discord bot that uses the Google Gemini API to provide intelligent responses to user queries.

## Features

- Responds to messages starting with `!ai <your query>`.
- Powered by Google's Gemini Pro model.

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

You need to provide your Discord Bot Token and Gemini API Key.

**Option 1: Using `config.py` (Recommended for local development)**

1.  Rename or copy the `config.py` file if it wasn't created (it should have been by the setup). If you don't have it, create it with the following content:
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
    ```
2.  Replace `"YOUR_DISCORD_BOT_TOKEN_HERE"` and `"YOUR_GEMINI_API_KEY_HERE"` with your actual token and key.
3.  **Important**: The `.gitignore` file is already configured to ignore `config.py`, so you won't accidentally commit your secret keys.

**Option 2: Using Environment Variables**

Set the following environment variables:
- `DISCORD_TOKEN`: Your Discord bot token.
- `GEMINI_API_KEY`: Your Gemini API key.

The `bot.py` script will automatically try to load these if `config.py` is not found or if the keys are not present there.

### 5. Invite Your Bot to Your Server
1. Go to your application in the Discord Developer Portal.
2. Go to the "OAuth2" tab, then "URL Generator".
3. Select the `bot` scope.
4. In "Bot Permissions", select "Read Messages/View Channels" and "Send Messages". You might need "Read Message History" as well.
5. Copy the generated URL and open it in your browser to invite the bot to your server.

## Running the Bot

Once you have completed the setup and configuration:
```bash
python bot.py
```
The bot should log in and print a confirmation message to your console. You can then test it in your Discord server using the `!ai` command.
