# Running Ace with Docker

This guide explains how to build and run Ace using Docker, including advanced options for mounting your project directory and setting the working directory.

---

## 1. Build the Docker image

Make sure Docker desktop is running and then run

```bash
docker build -t ace .
```

## 2. Prepare your environment

Make sure you have a `.env` file in your project root with your API keys (see the main README for details).

## 3. Run Ace in CLI mode (interactive)

```bash
docker run -it --env-file .env ace
```
- The `-it` flag gives you an interactive terminal for the CLI.
- You can also pass CLI arguments, for example:
  ```bash
  docker run -it --env-file .env ace -- --config-file configuration/ace.yml
  ```

## 4. Run Ace in Web UI mode

```bash
docker run --env-file .env -p 3000:3000 ace -- --mode web
```
- Access the Web UI at [http://localhost:3000](http://localhost:3000).
- To use a custom port:
  ```bash
  docker run --env-file .env -p 8080:8080 ace -- --mode web --web-port 8080
  ```

## 5. (Optional) Mount your project directory and set the working directory

If you want Ace (and its MCP servers) to access files from your host machine, you can mount your project directory into the container and set the working directory at runtime:

**On Linux/macOS:**
```bash
docker run -it --env-file .env -v ~/Projects/ace:/workspace -w /workspace ace
```
- `-v ~/Projects/ace:/workspace` mounts your local project directory into the container at `/workspace`.
- `-w /workspace` sets the working directory inside the container to `/workspace`.

**On Windows (Command Prompt):**
```cmd
docker run -it --env-file .env -v C:\Users\<YourUsername>\Projects\ace:/workspace -w /workspace ace
```
- Use your actual Windows username and path.
- If using PowerShell, you may need to quote the path:
  ```powershell
  docker run -it --env-file .env -v "C:\Users\<YourUsername>\Projects\ace:/workspace" -w /workspace ace
  ```
- If using Git Bash or WSL, you may use `/c/Users/<YourUsername>/Projects/ace:/workspace` as the path.

This allows Ace and its tool servers (like Filesystem MCP) to see and operate on your local files, just like when running outside Docker.

## 6. Passing Environment Variables (e.g., API keys)

You can also pass environment variables directly:

```bash
docker run -e OPENAI_API_KEY=your_openai_api_key -p 3000:3000 ace -- --mode web
```

## 7. Docker Compose & Cloud Deployment

### Docker Compose

When you're ready, you can start your application with Docker Compose.
You can update compose.yaml accordingly based on the containers you want, we have a sample file to get started.

```bash
docker compose up --build
```

Your application will be available at http://localhost:3000.

You can also override the command in Docker Compose using the `command:` field.

### Deploying to the Cloud

First, build your image for the appropriate platform (if needed):

```bash
docker build --platform=linux/amd64 -t myapp .
```

Then, push it to your registry:

```bash
docker push myregistry.com/myapp
```

Consult Docker's [getting started](https://docs.docker.com/go/get-started-sharing/) docs for more detail on building and pushing images.

## 8. References

- [Docker's Node.js guide](https://docs.docker.com/language/nodejs/)
- See the main [README.md](./README.md) for more details on configuration and usage.