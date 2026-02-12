/**
 * 🌐 Jarbas Remote Executor - Bridge Server
 * 
 * Permite que o Jarbas execute comandos no PC local via Tailscale
 * com suporte a PowerShell Admin, Codex, Claude, etc.
 */

require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
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
function executePowerShell(command, timeout, options = {}) {
  const script = String(command);
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

  return executeSpawnedCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
    timeout,
    options
  );
}

/**
 * Executa comando genérico (codex, claude, python, etc.)
 */
function executeCommand(tool, command, args = [], timeout, options = {}) {
  const finalArgs = [];
  const normalizedArgs = Array.isArray(args) ? args : [args];

  if (command !== undefined && command !== null && String(command).length > 0) {
    finalArgs.push(String(command));
  }

  for (const arg of normalizedArgs) {
    finalArgs.push(String(arg));
  }

  return executeSpawnedCommand(tool, finalArgs, timeout, options);
}

function executeSpawnedCommand(executable, args, timeout, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const cwd = options.cwd && String(options.cwd).trim().length > 0
      ? String(options.cwd).trim()
      : undefined;
    const background = options.background === true;

    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      detached: false,
      stdio: background ? 'ignore' : ['ignore', 'pipe', 'pipe']
    });

    if (background) {
      let settled = false;

      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        reject({
          error: err.message,
          executionTime: Date.now() - startTime
        });
      });

      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: Date.now() - startTime,
          background: true,
          pid: child.pid
        });
      });

      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;

      try {
        child.kill('SIGTERM');
      } catch (_) {}

      reject({
        error: 'Command timeout',
        timeout: true,
        stdout,
        stderr,
        executionTime: Date.now() - startTime
      });
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject({
        error: err.message,
        stdout,
        stderr,
        executionTime: Date.now() - startTime
      });
    });

    child.on('close', (exitCode) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const executionTime = Date.now() - startTime;
      if (exitCode === 0) {
        return resolve({ stdout, stderr, exitCode, executionTime });
      }

      reject({
        error: 'Command failed',
        stdout,
        stderr,
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
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
  const { tool, command, args = [], timeout, cwd, background = false } = req.body;
  
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
  
  log('info', 'Executing command', {
    tool,
    command: command.substring(0, 100),
    cwd: cwd || undefined,
    background: background === true
  });
  
  try {
    let result;
    
    const execOptions = { cwd, background };

    if (tool === 'powershell') {
      result = await executePowerShell(command, execTimeout, execOptions);
    } else {
      result = await executeCommand(tool, command, args, execTimeout, execOptions);
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

// ==================== JOBS ASSÍNCRONOS ====================

const jobs = new Map();
let jobCounter = 0;

function generateJobId() {
  jobCounter++;
  return `job_${Date.now()}_${jobCounter}`;
}

// Limpar jobs antigos (mais de 1 hora)
const jobCleanupInterval = setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, job] of jobs) {
    if (job.createdAt < oneHourAgo && job.status !== 'running') {
      jobs.delete(id);
    }
  }
}, 300000); // Limpa a cada 5 min
jobCleanupInterval.unref();

// Criar job assíncrono (retorna imediatamente com jobId)
app.post('/jobs/run', authMiddleware, async (req, res) => {
  const { tool, command, args = [], timeout, cwd, background = false } = req.body;

  if (!tool || !command) {
    return res.status(400).json({
      ok: false,
      error: 'Missing required fields: tool, command'
    });
  }

  if (CONFIG.ALLOWED_TOOLS && !CONFIG.ALLOWED_TOOLS.includes(tool)) {
    return res.status(403).json({
      ok: false,
      error: `Tool '${tool}' not allowed`
    });
  }

  const jobId = generateJobId();
  const execTimeout = timeout || CONFIG.COMMAND_TIMEOUT;

  const job = {
    id: jobId,
    tool,
    command: command.substring(0, 200),
    cwd: cwd || null,
    background,
    status: 'running',
    stdout: '',
    stderr: '',
    exitCode: null,
    pid: null,
    executionTime: null,
    createdAt: Date.now(),
    completedAt: null
  };

  jobs.set(jobId, job);

  log('info', 'Job started', {
    jobId,
    tool,
    command: command.substring(0, 100),
    cwd: cwd || undefined,
    background: background === true
  });

  // Executar em background
  (async () => {
    try {
      let result;
      const execOptions = { cwd, background };

      if (tool === 'powershell') {
        result = await executePowerShell(command, execTimeout, execOptions);
      } else {
        result = await executeCommand(tool, command, args, execTimeout, execOptions);
      }

      job.status = 'completed';
      job.stdout = result.stdout;
      job.stderr = result.stderr;
      job.exitCode = result.exitCode;
      job.pid = result.pid || null;
      job.executionTime = result.executionTime;
      job.completedAt = Date.now();

      log('info', 'Job completed', { jobId, exitCode: result.exitCode, executionTime: result.executionTime });
    } catch (err) {
      job.status = 'failed';
      job.stdout = err.stdout || '';
      job.stderr = err.stderr || '';
      job.exitCode = err.exitCode || 1;
      job.error = err.error || err.message || 'Execution failed';
      job.executionTime = err.executionTime;
      job.completedAt = Date.now();

      log('error', 'Job failed', { jobId, error: job.error });
    }
  })();

  // Retorna imediatamente
  res.json({
    ok: true,
    jobId,
    status: 'running',
    message: `Job started. Poll GET /jobs/${jobId} for status.`
  });
});

// Consultar status de um job
app.get('/jobs/:id', authMiddleware, (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({ ok: false, error: 'Job not found' });
  }

  res.json({
    ok: true,
    ...job,
    elapsed: job.status === 'running' ? Date.now() - job.createdAt : job.executionTime
  });
});

// Listar todos os jobs
app.get('/jobs', authMiddleware, (req, res) => {
  const jobList = Array.from(jobs.values()).map(j => ({
    id: j.id,
    tool: j.tool,
    command: j.command,
    cwd: j.cwd,
    background: j.background,
    status: j.status,
    pid: j.pid || null,
    createdAt: j.createdAt,
    elapsed: j.status === 'running' ? Date.now() - j.createdAt : j.executionTime
  }));

  res.json({ ok: true, jobs: jobList, count: jobList.length });
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

function startServer(port = CONFIG.PORT) {
  const server = app.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;

  console.log('\n' + '='.repeat(60));
  console.log('🌐 Jarbas Remote Bridge Server');
  console.log('='.repeat(60));
  console.log(`✅ Running on http://0.0.0.0:${actualPort}`);
  console.log(`🔒 Auth: Bearer token required`);
  console.log(`📋 Allowed tools: ${CONFIG.ALLOWED_TOOLS ? CONFIG.ALLOWED_TOOLS.join(', ') : 'ALL (unrestricted)'}`);
  console.log(`⏱️  Timeout: ${CONFIG.COMMAND_TIMEOUT}ms`);
  console.log(`📝 Logs: ${CONFIG.LOG_DIR}`);
  console.log('='.repeat(60) + '\n');
  
  log('info', 'Bridge server started', {
    port: actualPort,
    allowedTools: CONFIG.ALLOWED_TOOLS || 'ALL'
  });
});

  return server;
}

if (require.main === module) {
  const server = startServer();

  const shutdown = (signal) => {
    log('info', 'Shutting down bridge server', { signal });

    server.close(() => {
      process.exit(0);
    });

    // Fallback: não ficar travado se houver conexões abertas
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { app, CONFIG, startServer };

