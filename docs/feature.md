I want to review the opencode package, which I want to take inspiration from for setting up the agent.
Opencode is a coding agent that's opensource and easily extensible. It's written in typescript and uses ai-sdk by vercel.
But we're using llm-kit which is same in features as well. I've cloned the repo in /Users/saribmahmood/Documents/highlight/opencode/ folder.
The main code resides in packages/opencode directory. Go through it and setup the architecture of the our cocommand based on that.
We've already implemented some features.

Few key reminders:
1. we're not using mod.rs but ./module + ./module.rs approach instead
2. we want to integrate the virtual workspace system with the opencode style architecture
3. We want to use opencode as inspiration as to how it's modular and small modules for each feature in a directory, not copy it exactly.

TESTING:
1. You should run cargo checks to make sure there's no errors in rust
2. You should also test the endpoint properly. The server is already running (run it if it's not.)
3. With endpoints you should test the command sent by the user and make sure it opens the application and run the tools
4. I've added the keys, base url and model for the llm in the .env file if you need to use it or change it
