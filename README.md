# Usage
Slack and Smmry tokens are taken from the nonexistent file `auth.js` with the following structure:

```javascript
var keys = {
    "slack": "slack-key",
    "smmry": "smmry-key"
}

module.exports = {
    keys: keys
}
```

Create the `auth.js` file and populate it with your keys. Then run the bot with `node index.js`.

## Commands
To show all available commands use `help` in slack
