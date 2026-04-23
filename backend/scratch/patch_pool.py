
target_file = r'e:\Again Updated\live-project\backend\server.js'
with open(target_file, 'r', encoding='utf-8') as f:
    content = f.read()

old_config = """    connectionLimit: 50,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });"""

new_config = """    connectionLimit: 50,
    maxIdle: 10,
    idleTimeout: 10000,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 30000
  });"""

if old_config in content:
    print("Found old config, replacing...")
    new_content = content.replace(old_config, new_config)
    with open(target_file, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Replace success!")
else:
    # Try with CRLF
    old_config_crlf = old_config.replace('\n', '\r\n')
    if old_config_crlf in content:
        print("Found old config (CRLF), replacing...")
        new_content = content.replace(old_config_crlf, new_config.replace('\n', '\r\n'))
        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Replace success (CRLF)!")
    else:
        print("Could not find old config. Printing segment around line 350:")
        lines = content.splitlines()
        for i in range(344, 360):
            if i < len(lines):
                print(f"{i+1}: {repr(lines[i])}")
