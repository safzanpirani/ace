This doc describes how to test the ace exported files and ace CLI after making changes in 

### Testing library exports
This part tests the functions/classes/types that we export from ace for usage in programs.

1.  In the ace root directory, pack the build into a local tarball  
    ```bash
    npm run build
    npm pack
    ```  
    This produces something like  
    ```
    safzanpirani-ace-0.2.1.tgz
    ```

2.  Spin up a fresh, disposable test project  
    ```bash
    mkdir ~/tmp/ace-test && cd ~/tmp/ace-test
    npm init -y
    ```

3.  Install your packaged tarball  
    ```bash
    npm install /full/path/to/ace/safzanpirani-ace-0.2.1.tgz
    ```

4.  Verify CJS import resolution  
    • Create a file `test-cjs.js`:
    ```js
    // test-cjs.js
    const pkg = require('@safzanpirani/ace');
    console.log('CJS import →', pkg);
    ```  
    • Run it:
    ```bash
    node test-cjs.js
    ```
    You should see your exported object (and no "cannot find module" errors).

5.  Verify ESM import resolution  
    • Create `test-esm.mjs`:
    ```js
    // test-esm.mjs
    import pkg from '@safzanpirani/ace';
    console.log('ESM import →', pkg);
    ```  
    • Run it:
    ```bash
    node test-esm.mjs
    ```
    Again, you should see your package namespace.

6.  Check TypeScript typings  
    • Install TS (if you haven't):  
      ```bash
      npm install typescript --save-dev
      ```  
    • Create `test.d.ts`:
    ```ts
    import pkg from '@safzanpirani/ace';
    ```
    • Add a minimal `tsconfig.json`:
    ```jsonc
    {
      "compilerOptions": {
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "noEmit": true,
        "esModuleInterop": true
      }
    }
    ```  
    • Run:
    ```bash
    npx tsc
    ```  
    No errors means your `"types"` export is wired up correctly.

### Testing the CLI

Clean up old install
```
npm uninstall -g @safzanpirani/ace
cd <location of ace root directory>
```

Install again
```
npm run build && npm pack
# this will create a tarball safzanpirani-ace.<>.tgz
npm install -g ./safzanpirani-ace.0.2.1.tgz
```

Now go to another directory and test
```
cd ~
ace --help 
ace "what is the current time"
ace "list files in current directory"

# Test other model override in CLI
ace -m gpt-4o-mini "what is the current date"

# Test web mode
ace --mode web

# Test discord bot mode (requires additional setup)
ace --mode discord

# Test telegram bot mode (requires additional setup)
ace --mode telegram

# try the same in a few other directories
```