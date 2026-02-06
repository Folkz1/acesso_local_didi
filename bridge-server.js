/**
 * 🌐 Jarbas Remote Executor - Bridge Server
 * 
 * Permite que o Jarbas execute comandos no PC local via Tailscale
 * com suporte a PowerShell Admin, Codex, Claude, etc.
 */

require('dotenv').config();
const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ==================== CONFIGURAÇÃO ====================

const CONFIG = {
  PORT: process.env.BRIDGE_PORT || 8788,
  TOKEN: process.env.BRIDGE_TOKEN,
  ALLOWED_TOOLS: (process.env.ALLOWED_TOOLS || '*').trim() === '*'
    ? null  // null = sem restrição, aceita qualquer tool
    : process.env.ALLOWED_TOOLS.split(',').map(t => t.trim()),
  COMMAND_TIMEOUT: parseInt(process.env.COMMAND_TIMEOUT || '300000', 10), // 5 minutos
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_DIR: path.join(__dirname, 'logs')
};

// Criar diretório de logs
fs.ensureDirSync(CONFIG.LOG_DIR);

// ==================== LOGGING ====================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = LOG_LEVELS[CONFIG.LOG_LEVEL] || 1;

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] < currentLogLevel) return;
  
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message} ${JSON.stringify(meta)}\n`;
  
  console.log(logEntry.trim());
  
  const logFile = path.join(CONFIG.LOG_DIR, `bridge-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry);
}

// ==================== VALIDAÇÃO ====================

if (!CONFIG.TOKEN) {
  log('error', '❌ BRIDGE_TOKEN não configurado! Defina no .env');
  process.exit(1);
}

if (CONFIG.TOKEN.length < 32) {
  log('warn', '⚠️  BRIDGE_TOKEN muito curto! Use pelo menos 32 caracteres');
}

// ==================== MIDDLEWARE DE AUTH ====================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  
  if (token !== CONFIG.TOKEN) {
    log('warn', 'Unauthorized access attempt', { ip: req.ip, path: req.path });
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  
  next();
}

// ==================== VALIDAÇÃO DE PATH ====================

const ALLOWED_ROOTS = (process.env.ALLOWED_FILE_ROOTS || '').split(',').map(p => p.trim()).filter(Boolean);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function validatePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'Path is required' };
  }

  if (filePath.includes('..')) {
    return { valid: false, error: 'Path traversal not allowed' };
  }

  const resolved = path.resolve(filePath);

  if (ALLOWED_ROOTS.length > 0) {
    const allowed = ALLOWED_ROOTS.some(root =>
      resolved.toLowerCase().startsWith(path.resolve(root).toLowerCase())
    );
    if (!allowed) {
      return { valid: false, error: `Path outside allowed roots: ${ALLOWED_ROOTS.join(', ')}` };
    }
  }

  return { valid: true, resolved };
}

// ==================== EXECUTORES ====================

/**
 * Executa comando PowerShell com privilégios admin
 */
function executePowerShell(command, timeout) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    // PowerShell com ExecutionPolicy Bypass para admin
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ], {
      shell: true,
      windowsHide: true
    });
    
    let stdout = '';
    let stderr = '';
    let killed = false;
    
    const timer = setTimeout(() => {
      killed = true;
      ps.kill('SIGTERM');
      reject({ 
        error: 'Command timeout', 
        timeout: true,
        executionTime: Date.now() - startTime 
      });
    }, timeout);
    
    ps.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    ps.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ps.on('close', (exitCode) => {
      clearTimeout(timer);
      
      if (killed) return;
      
      const executionTime = Date.now() - startTime;
      
      if (exitCode === 0) {
        resolve({ stdout, stderr, exitCode, executionTime });
      } else {
        reject({ error: 'Command failed', stdout, stderr, exitCode, executionTime });
      }
    });
    
    ps.on('error', (err) => {
      clearTimeout(timer);
      reject({ error: err.message, executionTime: Date.now() - startTime });
    });
  });
}

/**
 * Executa comando genérico (codex, claude, python, etc.)
 */
function executeCommand(tool, command, args = [], timeout) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    // Montar comando completo
    const fullCommand = args.length > 0 
      ? `${tool} ${command} ${args.join(' ')}`
      : `${tool} ${command}`;
    
    exec(fullCommand, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      shell: 'powershell.exe'
    }, (error, stdout, stderr) => {
      const executionTime = Date.now() - startTime;
      
      if (error) {
        if (error.killed) {
          return reject({ 
            error: 'Command timeout', 
            timeout: true, 
            executionTime 
          });
        }
        
        return reject({
          error: error.message,
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error.code || 1,
          executionTime
        });
      }
      
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
        executionTime
      });
    });
  });
}

// ==================== ROTAS ====================

// Health check
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'jarbas-remote-bridge',
    status: 'running',
    uptime: process.uptime(),
    allowedTools: CONFIG.ALLOWED_TOOLS || 'ALL (unrestricted)',
    timeout: CONFIG.COMMAND_TIMEOUT
  });
});

// Executar comando
app.post('/run', authMiddleware, async (req, res) => {
  const { tool, command, args = [], timeout } = req.body;
  
  // Validação básica
  if (!tool || !command) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Missing required fields: tool, command' 
    });
  }
  
  // Verificar se a ferramenta é permitida (null = sem restrição)
  if (CONFIG.ALLOWED_TOOLS && !CONFIG.ALLOWED_TOOLS.includes(tool)) {
    log('warn', 'Tool not allowed', { tool, allowedTools: CONFIG.ALLOWED_TOOLS });
    return res.status(403).json({
      ok: false,
      error: `Tool '${tool}' not allowed. Allowed tools: ${CONFIG.ALLOWED_TOOLS.join(', ')}`
    });
  }
  
  const execTimeout = timeout || CONFIG.COMMAND_TIMEOUT;
  
  log('info', 'Executing command', { tool, command: command.substring(0, 100) });
  
  try {
    let result;
    
    if (tool === 'powershell') {
      result = await executePowerShell(command, execTimeout);
    } else {
      result = await executeCommand(tool, command, args, execTimeout);
    }
    
    log('info', 'Command completed', { 
      tool, 
      exitCode: result.exitCode, 
      executionTime: result.executionTime 
    });
    
    res.json({
      ok: true,
      ...result
    });
    
  } catch (err) {
    log('error', 'Command failed', { 
      tool, 
      error: err.error || err.message,
      executionTime: err.executionTime 
    });
    
    res.status(500).json({
      ok: false,
      error: err.error || 'Execution failed',
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.exitCode || 1,
      executionTime: err.executionTime
    });
  }
});

// ==================== OPERAÇÕES DE ARQUIVO ====================

// Ler arquivo
app.post('/files/read', authMiddleware, async (req, res) => {
  const { path: filePath, encoding = 'utf8' } = req.body;

  const check = validatePath(filePath);
  if (!check.valid) {
    return res.status(403).json({ ok: false, error: check.error });
  }

  try {
    const stat = await fs.stat(check.resolved);
    if (stat.size > MAX_FILE_SIZE) {
      return res.status(413).json({
        ok: false,
        error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max: 5MB. Use /run with PowerShell for large files.`
      });
    }

    const content = await fs.readFile(check.resolved, encoding);
    log('info', 'File read', { path: check.resolved, size: stat.size });

    res.json({ ok: true, content, size: stat.size, path: check.resolved });
  } catch (err) {
    log('error', 'File read failed', { path: check.resolved, error: err.message });
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ ok: false, error: err.message });
  }
});

// Escrever arquivo
app.post('/files/write', authMiddleware, async (req, res) => {
  const { path: filePath, content, createDirs = false } = req.body;

  if (content === undefined || content === null) {
    return res.status(400).json({ ok: false, error: 'Missing required field: content' });
  }

  const check = validatePath(filePath);
  if (!check.valid) {
    return res.status(403).json({ ok: false, error: check.error });
  }

  try {
    const existed = await fs.pathExists(check.resolved);

    if (createDirs) {
      await fs.ensureDir(path.dirname(check.resolved));
    }

    await fs.writeFile(check.resolved, content, 'utf8');
    log('info', 'File written', { path: check.resolved, size: content.length, created: !existed });

    res.json({ ok: true, path: check.resolved, size: content.length, created: !existed });
  } catch (err) {
    log('error', 'File write failed', { path: check.resolved, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Listar diretório
app.post('/files/list', authMiddleware, async (req, res) => {
  const { path: dirPath, recursive = false } = req.body;

  const check = validatePath(dirPath);
  if (!check.valid) {
    return res.status(403).json({ ok: false, error: check.error });
  }

  try {
    async function listEntries(dir, depth = 0) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      const entries = [];

      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        try {
          const stat = await fs.stat(fullPath);
          const entry = {
            name: item.name,
            path: fullPath,
            type: item.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modified: stat.mtime.toISOString()
          };

          entries.push(entry);

          if (recursive && item.isDirectory() && depth < 3) {
            const children = await listEntries(fullPath, depth + 1);
            entry.children = children;
          }
        } catch (e) {
          // Skip inaccessible entries
        }
      }

      return entries;
    }

    const entries = await listEntries(check.resolved);
    log('info', 'Directory listed', { path: check.resolved, count: entries.length });

    res.json({ ok: true, path: check.resolved, entries, count: entries.length });
  } catch (err) {
    log('error', 'Directory list failed', { path: check.resolved, error: err.message });
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ ok: false, error: err.message });
  }
});

// Deletar arquivo/pasta
app.post('/files/delete', authMiddleware, async (req, res) => {
  const { path: filePath, recursive = false } = req.body;

  const check = validatePath(filePath);
  if (!check.valid) {
    return res.status(403).json({ ok: false, error: check.error });
  }

  try {
    const stat = await fs.stat(check.resolved);

    if (stat.isDirectory() && !recursive) {
      return res.status(400).json({
        ok: false,
        error: 'Cannot delete directory without recursive: true'
      });
    }

    await fs.remove(check.resolved);
    log('info', 'File deleted', { path: check.resolved });

    res.json({ ok: true, path: check.resolved, deleted: true });
  } catch (err) {
    log('error', 'File delete failed', { path: check.resolved, error: err.message });
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ ok: false, error: err.message });
  }
});

// Info do arquivo
app.post('/files/info', authMiddleware, async (req, res) => {
  const { path: filePath } = req.body;

  const check = validatePath(filePath);
  if (!check.valid) {
    return res.status(403).json({ ok: false, error: check.error });
  }

  try {
    const exists = await fs.pathExists(check.resolved);

    if (!exists) {
      return res.json({ ok: true, path: check.resolved, exists: false });
    }

    const stat = await fs.stat(check.resolved);

    res.json({
      ok: true,
      path: check.resolved,
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      accessed: stat.atime.toISOString()
    });
  } catch (err) {
    log('error', 'File info failed', { path: check.resolved, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Editar arquivo (search-and-replace)
app.post('/files/edit', authMiddleware, async (req, res) => {
  const { path: filePath, search, replace, all = false } = req.body;

  if (!search || replace === undefined) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: search, replace' });
  }

  const check = validatePath(filePath);
  if (!check.valid) {
    return res.status(403).json({ ok: false, error: check.error });
  }

  try {
    let content = await fs.readFile(check.resolved, 'utf8');
    let replacements = 0;

    if (all) {
      const parts = content.split(search);
      replacements = parts.length - 1;
      content = parts.join(replace);
    } else {
      const idx = content.indexOf(search);
      if (idx !== -1) {
        content = content.substring(0, idx) + replace + content.substring(idx + search.length);
        replacements = 1;
      }
    }

    if (replacements > 0) {
      await fs.writeFile(check.resolved, content, 'utf8');
    }

    log('info', 'File edited', { path: check.resolved, replacements });

    res.json({ ok: true, path: check.resolved, replacements });
  } catch (err) {
    log('error', 'File edit failed', { path: check.resolved, error: err.message });
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ ok: false, error: err.message });
  }
});

// ==================== INICIAR SERVIDOR ====================

app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🌐 Jarbas Remote Bridge Server');
  console.log('='.repeat(60));
  console.log(`✅ Running on http://0.0.0.0:${CONFIG.PORT}`);
  console.log(`🔒 Auth: Bearer token required`);
  console.log(`📋 Allowed tools: ${CONFIG.ALLOWED_TOOLS ? CONFIG.ALLOWED_TOOLS.join(', ') : 'ALL (unrestricted)'}`);
  console.log(`⏱️  Timeout: ${CONFIG.COMMAND_TIMEOUT}ms`);
  console.log(`📝 Logs: ${CONFIG.LOG_DIR}`);
  console.log('='.repeat(60) + '\n');
  
  log('info', 'Bridge server started', {
    port: CONFIG.PORT,
    allowedTools: CONFIG.ALLOWED_TOOLS || 'ALL'
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('info', 'Shutting down bridge server');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('info', 'Shutting down bridge server');
  process.exit(0);
});
