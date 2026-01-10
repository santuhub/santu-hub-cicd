import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";

// Base path pour les volumes montés de l'hôte
const HOST_ROOT = "/host";

// Vérifier si les volumes de l'hôte sont montés
function isHostMounted(): boolean {
  return fs.existsSync(`${HOST_ROOT}/proc`) && 
         fs.existsSync(`${HOST_ROOT}/sys`) && 
         fs.existsSync(`${HOST_ROOT}/etc`);
}

// Fonction pour lire un fichier depuis l'hôte (si monté) ou depuis le conteneur
function readHostFile(path: string, fallback: () => string): string {
  // Avec --pid host, /proc/1/root pointe vers la racine de l'hôte
  // Essayer d'abord cette méthode (plus fiable)
  if (fs.existsSync("/proc/1/root")) {
    try {
      const proc1RootPath = `/proc/1/root${path}`;
      if (fs.existsSync(proc1RootPath)) {
        const stats = fs.statSync(proc1RootPath);
        // Vérifier que c'est un fichier (pas un répertoire)
        if (stats.isFile()) {
          const content = fs.readFileSync(proc1RootPath, "utf-8");
          if (content && content.trim().length > 0) {
            console.log(`✓ Lecture depuis /proc/1/root: ${path} (${content.length} bytes)`);
            return content.trim();
          }
        }
      }
    } catch (error: any) {
      console.log(`✗ Erreur lecture /proc/1/root${path}: ${error.message}`);
      // Continuer avec les autres méthodes
    }
  }
  
  // Essayer avec les volumes montés
  const hostPath = `${HOST_ROOT}${path}`;
  
  if (isHostMounted()) {
    try {
      if (fs.existsSync(hostPath)) {
        const stats = fs.statSync(hostPath);
        // Vérifier que c'est un fichier (pas un répertoire)
        if (stats.isFile()) {
          const content = fs.readFileSync(hostPath, "utf-8");
          if (content && content.trim().length > 0) {
            console.log(`✓ Lecture depuis l'hôte (volume): ${hostPath} (${content.length} bytes)`);
            return content.trim();
          }
        }
      }
    } catch (error: any) {
      console.log(`✗ Erreur lecture ${hostPath}: ${error.message}`);
    }
  }
  
  // Fallback: lire depuis le conteneur
  try {
    if (fs.existsSync(path)) {
      const stats = fs.statSync(path);
      if (stats.isFile()) {
        const content = fs.readFileSync(path, "utf-8");
        if (content && content.trim().length > 0) {
          console.log(`⚠ Lecture depuis le conteneur: ${path} (${content.length} bytes)`);
          return content.trim();
        }
      }
    }
  } catch (error: any) {
    console.log(`✗ Erreur lecture ${path}: ${error.message}`);
  }
  
  return fallback();
}

// Fonction pour obtenir les infos CPU depuis l'hôte
function getHostCPUInfo(): { model: string; count: number } {
  const cpuInfo = readHostFile("/proc/cpuinfo", () => {
    const cpus = os.cpus();
    return cpus.length > 0 ? `model name\t: ${cpus[0].model}\nprocessor\t: 0` : "";
  });

  if (cpuInfo && cpuInfo.length > 0) {
    const lines = cpuInfo.split("\n");
    
    // Chercher le modèle CPU - format: "model name\t: Intel(R) Xeon(R) CPU E5-2673 v4 @ 2.30GHz"
    let modelLine = lines.find((line) => {
      const lower = line.toLowerCase();
      return lower.includes("model name") || 
             (lower.includes("model") && lower.includes("name")) ||
             line.match(/^model\s+name\s*[:=]/i);
    });
    
    // Si pas trouvé, chercher avec tabulation
    if (!modelLine) {
      modelLine = lines.find((line) => line.match(/^model\s+name\s*[:=]/i));
    }
    
    // Fallback pour ARM
    if (!modelLine) {
      modelLine = lines.find((line) => 
        line.includes("Hardware") || 
        line.includes("Processor") ||
        line.includes("CPU implementer")
      );
    }
    
    let model = "Unknown";
    if (modelLine) {
      // Extraire le modèle après ":" ou "="
      const match = modelLine.match(/[:=]\s*(.+)/);
      if (match && match[1]) {
        model = match[1].trim();
      } else {
        // Si pas de match, prendre toute la ligne après "model name"
        const parts = modelLine.split(/[:=]/);
        if (parts.length > 1) {
          model = parts.slice(1).join(":").trim();
        } else {
          model = modelLine.trim();
        }
      }
    }
    
    // Compter les processeurs - chercher toutes les lignes "processor : 0", "processor : 1", etc.
    const processorLines = lines.filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("processor") && 
             (trimmed.match(/^processor\s*[:=]/i) || trimmed.match(/^processor\s+\d+/i));
    });
    
    // Si on trouve des lignes processor, utiliser leur nombre
    // Sinon, chercher "CPU(s)" dans /proc/cpuinfo ou utiliser os.cpus()
    let count = processorLines.length;
    
    if (count === 0) {
      // Essayer de trouver "CPU(s)" dans les lignes
      const cpuCountLine = lines.find((line) => line.toLowerCase().includes("cpu(s)"));
      if (cpuCountLine) {
        const match = cpuCountLine.match(/(\d+)/);
        if (match) {
          count = parseInt(match[1]);
        }
      }
      
      // Si toujours 0, utiliser os.cpus()
      if (count === 0) {
        count = os.cpus().length;
      }
    }
    
    return { model: model || "Unknown", count: count || 1 };
  }

  const cpus = os.cpus();
  return { model: cpus[0]?.model || "Unknown", count: cpus.length };
}

// Fonction pour obtenir la mémoire depuis l'hôte
function getHostMemory(): { total: number; free: number; available: number } {
  const memInfo = readHostFile("/proc/meminfo", () => {
    return `MemTotal: ${Math.floor(os.totalmem() / 1024)} kB\nMemAvailable: ${Math.floor(os.freemem() / 1024)} kB\nMemFree: ${Math.floor(os.freemem() / 1024)} kB`;
  });

  let total = os.totalmem();
  let free = os.freemem();
  let available = os.freemem();

  if (memInfo && memInfo.length > 0) {
    const lines = memInfo.split("\n");
    const totalLine = lines.find((line) => line.startsWith("MemTotal"));
    const availableLine = lines.find((line) => line.startsWith("MemAvailable"));
    const freeLine = lines.find((line) => line.startsWith("MemFree"));

    if (totalLine) {
      const totalMatch = totalLine.match(/(\d+)/);
      if (totalMatch) {
        total = parseInt(totalMatch[1]) * 1024; // Convertir de kB en bytes
      }
    }

    // MemAvailable est la mémoire réellement disponible pour les applications
    if (availableLine) {
      const availableMatch = availableLine.match(/(\d+)/);
      if (availableMatch) {
        available = parseInt(availableMatch[1]) * 1024; // Convertir de kB en bytes
      }
    }

    // MemFree est la mémoire complètement libre
    if (freeLine) {
      const freeMatch = freeLine.match(/(\d+)/);
      if (freeMatch) {
        free = parseInt(freeMatch[1]) * 1024; // Convertir de kB en bytes
      }
    }
  }

  return { total, free, available };
}

// Fonction pour obtenir l'uptime depuis l'hôte
function getHostUptime(): number {
  const uptime = readHostFile("/proc/uptime", () => os.uptime().toString());

  if (uptime && uptime.length > 0) {
    const match = uptime.match(/^(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : os.uptime();
  }
  return os.uptime();
}

// Fonction pour obtenir le hostname depuis l'hôte
function getHostHostname(): string {
  // Essayer d'abord /proc/sys/kernel/hostname (plus fiable avec --pid host)
  let hostname = readHostFile("/proc/sys/kernel/hostname", () => "");
  
  if (hostname && hostname.length > 0 && !hostname.match(/^[0-9a-f]{12}$/i) && hostname !== "host") {
    return hostname.trim();
  }
  
  // Essayer /etc/hostname
  hostname = readHostFile("/etc/hostname", () => "");
  
  if (hostname && hostname.length > 0) {
    // Exclure les IDs de conteneur Docker (12 caractères hexadécimaux)
    if (hostname.match(/^[0-9a-f]{12}$/i) || hostname === "host") {
      // Fallback si c'est un ID Docker
    } else {
      return hostname.trim();
    }
  }
  
  return os.hostname();
}

// Fonction pour obtenir l'OS depuis l'hôte
function getHostOS(): { type: string; release: string } {
  let type = os.type();
  let release = os.release();

  const osRelease = readHostFile("/etc/os-release", () => "");
  const procVersion = readHostFile("/proc/version", () => "");

  if (procVersion && procVersion.length > 0 && !procVersion.includes("linuxkit")) {
    const versionMatch = procVersion.match(/Linux version ([^\s]+)/);
    if (versionMatch) {
      release = versionMatch[1];
      type = "Linux";
    }
  }

  if (osRelease && osRelease.includes("PRETTY_NAME")) {
    const match = osRelease.match(/PRETTY_NAME="?([^"]+)"?/);
    if (match) {
      const prettyName = match[1];
      type = "Linux";
      if (!procVersion || procVersion.includes("linuxkit")) {
        if (prettyName.includes("Ubuntu")) {
          const versionMatch = prettyName.match(/(\d+\.\d+)/);
          release = versionMatch ? `Ubuntu ${versionMatch[1]}` : prettyName;
        } else if (prettyName.includes("Debian")) {
          release = prettyName;
        } else {
          release = prettyName;
        }
      }
    }
  }

  return { type, release };
}

// Fonction pour obtenir la charge CPU depuis l'hôte
function getHostLoadAvg(): number[] {
  const loadAvg = readHostFile("/proc/loadavg", () => os.loadavg().join(" "));

  if (loadAvg && loadAvg.length > 0) {
    const parts = loadAvg.split(/\s+/);
    if (parts.length >= 3) {
      return [
        parseFloat(parts[0]) || 0,
        parseFloat(parts[1]) || 0,
        parseFloat(parts[2]) || 0,
      ];
    }
  }

  return os.loadavg();
}

// Fonction pour obtenir l'utilisation CPU réelle depuis l'hôte
// Note: Pour un calcul précis, il faudrait deux lectures de /proc/stat avec un délai
// Ici, on utilise une approximation basée sur la charge moyenne
function getHostCPUUsage(): number {
  try {
    // Lire /proc/stat pour obtenir des informations sur le CPU
    const stat = readHostFile("/proc/stat", () => "");
    
    if (stat && stat.length > 0) {
      const lines = stat.split("\n");
      const cpuLine = lines.find((line) => line.startsWith("cpu "));
      
      if (cpuLine) {
        // Format: cpu  user nice system idle iowait irq softirq steal guest guest_nice
        const parts = cpuLine.trim().split(/\s+/);
        
        if (parts.length >= 5) {
          // user, nice, system, idle, iowait, irq, softirq, steal
          const user = parseFloat(parts[1]) || 0;
          const nice = parseFloat(parts[2]) || 0;
          const system = parseFloat(parts[3]) || 0;
          const idle = parseFloat(parts[4]) || 0;
          const iowait = parseFloat(parts[5]) || 0;
          const irq = parseFloat(parts[6]) || 0;
          const softirq = parseFloat(parts[7]) || 0;
          const steal = parseFloat(parts[8]) || 0;
          
          // Total des ticks CPU
          const totalIdle = idle + iowait;
          const totalNonIdle = user + nice + system + irq + softirq + steal;
          const total = totalIdle + totalNonIdle;
          
          // Pourcentage d'utilisation = (non-idle / total) * 100
          // Note: Ceci donne une moyenne depuis le boot, pas l'utilisation actuelle
          // Pour l'utilisation actuelle, il faudrait deux lectures avec un délai
          if (total > 0) {
            const usage = (totalNonIdle / total) * 100;
            return Math.min(Math.max(usage, 0), 100);
          }
        }
      }
    }
  } catch (error) {
    console.log("Erreur lors du calcul de l'utilisation CPU:", error);
  }
  
  // Fallback: utiliser loadavg comme approximation
  // Le load average n'est pas un pourcentage, mais on peut l'utiliser comme indicateur
  // Load average de 1.0 sur 1 CPU = 100% d'utilisation
  const loadAvg = getHostLoadAvg();
  const cpuCount = getHostCPUInfo().count;
  
  // Convertir load average en pourcentage approximatif
  // Load avg représente la charge moyenne sur 1, 5 et 15 minutes
  // On utilise la charge sur 1 minute et on la divise par le nombre de CPUs
  const loadPercent = (loadAvg[0] / cpuCount) * 100;
  
  // Le load average peut être > 100% si le système est surchargé
  // On limite à 100% pour l'affichage
  return Math.min(loadPercent, 100);
}

// Fonction pour obtenir l'architecture depuis l'hôte
function getHostArch(): string {
  // Essayer d'abord /proc/cpuinfo
  const cpuInfo = readHostFile("/proc/cpuinfo", () => "");
  
  if (cpuInfo && cpuInfo.length > 0) {
    const lines = cpuInfo.split("\n");
    
    // Chercher directement "x86_64" ou "aarch64" dans les lignes
    for (const line of lines) {
      if (line.toLowerCase().includes("x86_64") || line.toLowerCase().includes("amd64")) {
        return "x64";
      }
      if (line.toLowerCase().includes("aarch64") || line.toLowerCase().includes("arm64")) {
        return "arm64";
      }
      if (line.toLowerCase().includes("armv7") || line.toLowerCase().includes("armv6")) {
        return "arm";
      }
    }
    
    // Chercher dans les flags
    const flagsLine = lines.find((line) => line.includes("flags") || line.includes("Features"));
    
    if (flagsLine) {
      if (flagsLine.includes("lm") || flagsLine.includes("x86_64")) {
        return "x64";
      } else if (flagsLine.includes("aarch64")) {
        return "arm64";
      }
    }

    // Chercher dans les informations processeur
    const processorLine = lines.find((line) =>
      line.includes("Processor") ||
      line.includes("CPU architecture") ||
      line.includes("CPU implementer")
    );
    
    if (processorLine) {
      if (processorLine.includes("aarch64") || processorLine.includes("ARMv8")) {
        return "arm64";
      } else if (processorLine.includes("armv7") || processorLine.includes("ARMv7")) {
        return "arm";
      }
    }
  }
  
  // Essayer /proc/version pour détecter l'architecture
  const procVersion = readHostFile("/proc/version", () => "");
  if (procVersion) {
    if (procVersion.includes("x86_64") || procVersion.includes("amd64")) {
      return "x64";
    }
    if (procVersion.includes("aarch64") || procVersion.includes("arm64")) {
      return "arm64";
    }
  }
  
  return os.arch();
}

// Fonction pour exécuter une commande dans l'espace de noms de l'hôte avec nsenter
// Note: nsenter nécessite des permissions root, donc cette méthode peut échouer
function execInHostNamespace(command: string): string | null {
  try {
    // Vérifier si /proc/1 existe (nécessaire pour --pid host)
    if (!fs.existsSync("/proc/1")) {
      console.log("  /proc/1 n'existe pas, --pid host non utilisé?");
      return null;
    }
    
    // Vérifier si nsenter est disponible
    try {
      execSync("which nsenter 2>/dev/null", { encoding: "utf-8", timeout: 1000 });
    } catch {
      console.log("  nsenter non disponible");
      return null;
    }
    
    // Utiliser nsenter pour exécuter la commande dans l'espace de noms de l'hôte
    // --target 1: PID 1 de l'hôte (accessible avec --pid host)
    // --mount: entrer dans le namespace mount
    // --uts: entrer dans le namespace UTS (hostname)
    // --net: entrer dans le namespace réseau
    // Note: On omet --ipc car il nécessite des permissions root
    const result = execSync(
      `nsenter --target 1 --mount --uts --net -- sh -c "${command.replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`,
      { encoding: "utf-8", timeout: 3000, stdio: "pipe" }
    );
    
    return result.trim();
  } catch (error: any) {
    console.log(`  nsenter error (peut nécessiter root): ${error.message}`);
    return null;
  }
}

// Fonction pour obtenir l'IP de l'hôte
function getHostIP(): string {
  console.log("=== Début de la récupération de l'IP ===");
  try {
    // Méthode 0: Essayer d'utiliser hostname -i via nsenter (le plus fiable)
    console.log("Méthode 0: hostname -i via nsenter");
    try {
      const hostnameIP = execInHostNamespace("hostname -i 2>/dev/null");
      console.log(`  hostname -i result: "${hostnameIP}"`);
      if (hostnameIP && hostnameIP.length > 0 && hostnameIP !== "127.0.0.1" && !hostnameIP.includes("::1")) {
        // hostname -i peut retourner plusieurs IPs, prendre la première
        const firstIP = hostnameIP.split(/\s+/)[0];
        if (firstIP && firstIP.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
          // Filtrer les IPs Docker
          const ipParts = firstIP.split(".");
          const firstOctet = parseInt(ipParts[0]);
          const secondOctet = parseInt(ipParts[1]);
          const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
          
          if (!isDockerIP) {
            console.log(`✓ IP depuis hostname -i (nsenter): ${firstIP}`);
            return firstIP;
          } else {
            console.log(`  IP rejetée (Docker): ${firstIP}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`  hostname -i via nsenter failed: ${e.message}`);
    }
    
    // Méthode 0.1: Essayer ip addr show via nsenter (plus universel)
    console.log("Méthode 0.1: ip addr show via nsenter");
    try {
      const ipOutput = execInHostNamespace("ip -4 addr show 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | head -1");
      console.log(`  ip addr show output: "${ipOutput}"`);
      
      if (ipOutput) {
        // Format: inet 192.168.0.19/24 brd 192.168.0.255 scope global eth0
        const ipMatch = ipOutput.match(/inet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        if (ipMatch && ipMatch[1]) {
          const ip = ipMatch[1];
          // Filtrer les IPs Docker
          const ipParts = ip.split(".");
          const firstOctet = parseInt(ipParts[0]);
          const secondOctet = parseInt(ipParts[1]);
          const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
          
          if (ip !== "127.0.0.1" && !isDockerIP) {
            console.log(`✓ IP depuis ip addr show (nsenter): ${ip}`);
            return ip;
          } else {
            console.log(`  IP rejetée (Docker ou loopback): ${ip}`);
          }
        }
      } else {
        console.log("  ip addr show n'a retourné aucune sortie");
      }
    } catch (e: any) {
      console.log(`  ip addr show via nsenter failed: ${e.message}`);
    }
    
    // Méthode 0.5: Lire depuis /sys/class/net pour trouver les interfaces et leurs IPs
    // Cette méthode fonctionne sur tous les systèmes Linux
    console.log("Méthode 0.5: Lecture de /sys/class/net");
    try {
      // Essayer d'abord avec /proc/1/root (si --pid host)
      let netDir = "/proc/1/root/sys/class/net";
      if (!fs.existsSync(netDir)) {
        // Fallback vers /sys/class/net du conteneur
        netDir = "/sys/class/net";
      }
      
      if (fs.existsSync(netDir)) {
        const interfaces = fs.readdirSync(netDir);
        console.log(`  Interfaces trouvées: ${interfaces.join(", ")}`);
        
        // Pour chaque interface non-loopback, chercher son IP
        for (const iface of interfaces) {
          if (iface === "lo") continue; // Ignorer loopback
          
          // Lire l'adresse MAC de l'interface
          const macFile = `${netDir}/${iface}/address`;
          if (fs.existsSync(macFile)) {
            try {
              const mac = fs.readFileSync(macFile, "utf-8").trim();
              console.log(`  Interface ${iface}, MAC: ${mac}`);
              
              // Chercher l'IP de cette interface dans /proc/net/arp en utilisant le MAC
              // ou dans /proc/net/fib_trie en utilisant le nom de l'interface
            } catch (e: any) {
              console.log(`  Erreur lecture MAC pour ${iface}: ${e.message}`);
            }
          }
        }
      }
    } catch (e: any) {
      console.log(`  Reading /sys/class/net failed: ${e.message}`);
    }
    
    // Méthode 1: Lire depuis /proc/net/fib_trie (contient toutes les IPs locales)
    // Note: fib_trie peut contenir beaucoup d'IPs, on doit bien filtrer
    console.log("Méthode 1: Lecture de /proc/net/fib_trie");
    let fibTrie = readHostFile("/proc/net/fib_trie", () => "");
    console.log(`fib_trie length: ${fibTrie ? fibTrie.length : 0}`);
    
    if (fibTrie && fibTrie.length > 0) {
      // Parser fib_trie pour trouver les IPs locales
      // Le format de fib_trie est complexe, on cherche les IPs qui ne sont pas dans la plage 127.x.x.x
      const lines = fibTrie.split("\n");
      const localIPs: string[] = [];
      
      // Chercher toutes les IPs dans le fichier, mais filtrer intelligemment
      // fib_trie contient des plages d'IPs, on cherche les IPs individuelles
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Chercher toutes les IPs dans chaque ligne
        const ipMatches = Array.from(line.matchAll(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g));
        for (const match of ipMatches) {
          const ip = match[1];
          const ipParts = ip.split(".");
          
          // Vérifier que c'est une IP valide
          if (ipParts.length === 4 && ipParts.every(part => {
            const num = parseInt(part);
            return !isNaN(num) && num >= 0 && num <= 255;
          })) {
            const firstOctet = parseInt(ipParts[0]);
            const secondOctet = parseInt(ipParts[1]);
            
            // Filtrer les IPs invalides :
            // - 127.x.x.x (loopback - TOUTE la plage)
            // - 0.0.0.0 (non-routable)
            // - 255.255.255.255 (broadcast)
            // - 172.16.x.x - 172.31.x.x (Docker)
            const isLoopback = firstOctet === 127;
            const isNonRoutable = ip === "0.0.0.0" || ip === "255.255.255.255";
            const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
            
            if (!isLoopback && !isNonRoutable && !isDockerIP && !localIPs.includes(ip)) {
              localIPs.push(ip);
              console.log(`  Trouvé IP dans fib_trie: ${ip}`);
            }
          }
        }
      }
      
      if (localIPs.length > 0) {
        // Retourner la première IP valide (généralement la principale)
        // Préférer les IPs dans les plages privées communes (192.168.x.x, 10.x.x.x)
        const privateIP = localIPs.find(ip => ip.startsWith("192.168.") || ip.startsWith("10."));
        if (privateIP) {
          console.log(`✓ IP depuis fib_trie (privée): ${privateIP}`);
          return privateIP;
        }
        console.log(`✓ IP depuis fib_trie: ${localIPs[0]}`);
        return localIPs[0];
      } else {
        console.log("  Aucune IP valide trouvée dans fib_trie (seulement loopback/Docker)");
        // Afficher un échantillon pour déboguer
        if (fibTrie.length > 0) {
          console.log(`  Échantillon fib_trie (premières 300 chars): ${fibTrie.substring(0, 300)}`);
        }
      }
    } else {
      console.log("  fib_trie est vide ou inaccessible");
    }
    
    // Méthode 2: Lire depuis /proc/net/route pour trouver l'interface principale puis son IP
    console.log("Méthode 2: Lecture de /proc/net/route");
    const route = readHostFile("/proc/net/route", () => "");
    console.log(`route length: ${route ? route.length : 0}`);
    
    if (route && route.length > 0) {
      const lines = route.split("\n");
      console.log(`Nombre de lignes dans route: ${lines.length}`);
      
      // Format de /proc/net/route:
      // Iface   Destination     Gateway         Flags   RefCnt  Use     Metric  Mask            MTU     Window  IRTT
      // eth0    00000000        010AA800        ...     ...     ...     ...     ...             ...     ...     ...
      // 
      // Colonnes: 0=Iface, 1=Destination, 2=Gateway, 3=Flags, 4=RefCnt, 5=Use, 6=Metric, 7=Mask, 8=MTU, 9=Window, 10=IRTT
      // L'IP source n'est pas directement dans ce fichier, mais on peut trouver l'interface principale
      
      // Étape 1: Trouver l'interface principale (celle avec la route par défaut)
      let mainInterface: string | null = null;
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 3) {
          const iface = parts[0];
          const dest = parts[1];
          
          // Chercher la route par défaut (dest = 00000000) sur une interface non-loopback
          if (iface && iface !== "lo" && dest === "00000000") {
            mainInterface = iface;
            console.log(`  ✓ Interface principale trouvée: ${mainInterface}`);
            break;
          }
        }
      }
      
        // Étape 2: Si on a trouvé une interface principale, chercher son IP
        if (mainInterface) {
          // Méthode 2.1: Lire le MAC de l'interface puis chercher l'IP dans ARP
          console.log(`  Cherchant le MAC de ${mainInterface}...`);
          let interfaceMAC: string | null = null;
          try {
            // Essayer avec /proc/1/root d'abord
            let macFile = `/proc/1/root/sys/class/net/${mainInterface}/address`;
            if (!fs.existsSync(macFile)) {
              macFile = `/host/sys/class/net/${mainInterface}/address`;
            }
            if (!fs.existsSync(macFile)) {
              macFile = `/sys/class/net/${mainInterface}/address`;
            }
            
            if (fs.existsSync(macFile)) {
              interfaceMAC = fs.readFileSync(macFile, "utf-8").trim();
              console.log(`  MAC de ${mainInterface}: ${interfaceMAC}`);
            }
          } catch (e: any) {
            console.log(`  Erreur lecture MAC: ${e.message}`);
          }
          
          // Méthode 2.2: Chercher l'IP de cette interface dans /proc/net/arp
          // ARP contient les IPs des interfaces avec leur device et MAC
          console.log(`  Cherchant l'IP de ${mainInterface} dans ARP...`);
          const arpForInterface = readHostFile("/proc/net/arp", () => "");
          if (arpForInterface && arpForInterface.length > 0) {
            const arpLines = arpForInterface.split("\n");
            for (let j = 1; j < arpLines.length; j++) {
              const arpParts = arpLines[j].trim().split(/\s+/);
              // Format: IP address   HW type   Flags   HW address   Mask   Device
              //         192.168.0.19  0x1       0x2     aa:bb:cc:dd  *     eth0
              if (arpParts.length >= 6) {
                const arpIP = arpParts[0];
                const arpMAC = arpParts[3];
                const arpDevice = arpParts[5];
                
                // Vérifier que c'est bien notre interface
                if (arpDevice === mainInterface) {
                  if (arpIP && arpIP.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
                    // Si on a le MAC, vérifier qu'il correspond
                    if (interfaceMAC && arpMAC !== interfaceMAC) {
                      console.log(`  MAC ne correspond pas: ${arpMAC} vs ${interfaceMAC}`);
                      continue;
                    }
                    
                    const ipParts = arpIP.split(".");
                    const firstOctet = parseInt(ipParts[0]);
                    const secondOctet = parseInt(ipParts[1]);
                    const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
                    
                    if (arpIP !== "127.0.0.1" && arpIP !== "0.0.0.0" && !isDockerIP) {
                      console.log(`✓ IP depuis ARP pour ${mainInterface}: ${arpIP}`);
                      return arpIP;
                    }
                  }
                }
              }
            }
          }
          
          // Méthode 2.3: Chercher l'IP dans les routes, mais ignorer les masques (colonne 7)
          // Format: Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT
          // La colonne 7 est le masque, pas l'IP. On ne doit pas la prendre.
          console.log(`  Cherchant l'IP dans les routes de ${mainInterface} (en ignorant les masques)...`);
          const interfaceIPs: string[] = [];
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].trim().split(/\s+/);
            if (parts.length >= 3 && parts[0] === mainInterface) {
              // Colonne 2 = Gateway (peut être utile)
              // Colonne 7 = Mask (à ignorer - ce sont des masques comme 255.255.0.0)
              // On ne prend que les colonnes qui pourraient être des IPs (pas les masques)
              
              // Ignorer la colonne 7 (masque) et chercher ailleurs
              for (let col = 2; col < Math.min(parts.length, 8); col++) {
                // Ignorer la colonne 7 qui est le masque
                if (col === 7) continue;
                
                const hexValue = parts[col];
                if (hexValue && hexValue.length === 8 && hexValue !== "00000000" && /^[0-9a-fA-F]{8}$/.test(hexValue)) {
                  try {
                    const ip = [
                      parseInt(hexValue.substring(6, 8), 16),
                      parseInt(hexValue.substring(4, 6), 16),
                      parseInt(hexValue.substring(2, 4), 16),
                      parseInt(hexValue.substring(0, 2), 16),
                    ].join(".");
                    
                    // Filtrer les masques de sous-réseau communs
                    const isSubnetMask = ip === "255.255.255.255" || 
                                        ip === "255.255.255.0" || 
                                        ip === "255.255.0.0" || 
                                        ip === "255.0.0.0" ||
                                        ip.startsWith("255.");
                    
                    if (isSubnetMask) {
                      console.log(`  Ignoré (masque): ${ip}`);
                      continue;
                    }
                    
                    const ipParts = ip.split(".");
                    const firstOctet = parseInt(ipParts[0]);
                    const secondOctet = parseInt(ipParts[1]);
                    const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
                    
                    if (ip !== "0.0.0.0" && ip !== "127.0.0.1" && !isDockerIP && !interfaceIPs.includes(ip)) {
                      interfaceIPs.push(ip);
                      console.log(`  Trouvé IP potentielle pour ${mainInterface}: ${ip} (colonne ${col})`);
                    }
                  } catch (e) {
                    // Continuer
                  }
                }
              }
            }
          }
          
          if (interfaceIPs.length > 0) {
            // Préférer les IPs privées
            const privateIP = interfaceIPs.find(ip => ip.startsWith("192.168.") || ip.startsWith("10."));
            if (privateIP) {
              console.log(`✓ IP depuis route (toutes routes de ${mainInterface}): ${privateIP}`);
              return privateIP;
            }
            console.log(`✓ IP depuis route (toutes routes de ${mainInterface}): ${interfaceIPs[0]}`);
            return interfaceIPs[0];
          }
          
          // Méthode 2.3: Chercher l'IP de cette interface dans fib_trie
          if (!fibTrie || fibTrie.length === 0) {
            fibTrie = readHostFile("/proc/net/fib_trie", () => "");
          }
          
          if (fibTrie && fibTrie.length > 0 && mainInterface) {
            // Créer une variable locale pour que TypeScript comprenne que mainInterface n'est pas null
            const interfaceName = mainInterface;
            // Chercher toutes les occurrences de cette interface dans fib_trie
            const ifaceLines = fibTrie.split("\n").filter(line => line.includes(interfaceName));
            console.log(`  Lignes avec ${interfaceName} dans fib_trie: ${ifaceLines.length}`);
            
            for (const ifaceLine of ifaceLines) {
              const ipMatches = Array.from(ifaceLine.matchAll(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g));
              for (const match of ipMatches) {
                const ip = match[1];
                const ipParts = ip.split(".");
                const firstOctet = parseInt(ipParts[0]);
                const secondOctet = parseInt(ipParts[1]);
                const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
                
                if (ip !== "127.0.0.1" && ip !== "0.0.0.0" && !isDockerIP && !ip.startsWith("127.")) {
                  console.log(`✓ IP depuis route + fib_trie: ${ip}`);
                  return ip;
                }
              }
            }
          }
        }
    }
    
    // Méthode 3: Lire depuis /proc/net/arp (contient les IPs des interfaces)
    // Note: ARP contient les IPs des interfaces locales et des machines sur le réseau
    console.log("Méthode 3: Lecture de /proc/net/arp");
    const arp = readHostFile("/proc/net/arp", () => "");
    console.log(`arp length: ${arp ? arp.length : 0}`);
    
    if (arp && arp.length > 0) {
      const lines = arp.split("\n");
      const arpIPs: string[] = [];
      
      // Format de /proc/net/arp:
      // IP address       HW type     Flags       HW address            Mask     Device
      // 192.168.0.19     0x1         0x2         aa:bb:cc:dd:ee:ff     *        eth0
      
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 1) {
          const ip = parts[0];
          const device = parts.length >= 6 ? parts[5] : "";
          
          // Vérifier que c'est une IP valide et non loopback/Docker
          if (ip && ip.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) && 
              ip !== "127.0.0.1" && ip !== "0.0.0.0") {
            // Filtrer les IPs Docker (172.16.0.0/12)
            const ipParts = ip.split(".");
            const firstOctet = parseInt(ipParts[0]);
            const secondOctet = parseInt(ipParts[1]);
            const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
            
            if (!isDockerIP) {
              arpIPs.push(ip);
              console.log(`  Trouvé IP dans ARP: ${ip} (device: ${device})`);
            }
          }
        }
      }
      
      if (arpIPs.length > 0) {
        // Préférer les IPs privées
        const privateIP = arpIPs.find(ip => ip.startsWith("192.168.") || ip.startsWith("10."));
        if (privateIP) {
          console.log(`✓ IP depuis ARP (privée): ${privateIP}`);
          return privateIP;
        }
        console.log(`✓ IP depuis ARP: ${arpIPs[0]}`);
        return arpIPs[0];
      } else {
        console.log("  Aucune IP valide trouvée dans ARP");
      }
    } else {
      console.log("  ARP est vide ou inaccessible");
    }
  } catch (error: any) {
    console.log(`Erreur lors de la récupération de l'IP: ${error.message}`);
    console.log(error.stack);
  }
  
  // Fallback: utiliser l'IP du conteneur (si on ne peut pas accéder à l'hôte)
  // Mais filtrer les IPs Docker
  console.log("Méthode Fallback: os.networkInterfaces()");
  const interfaces = os.networkInterfaces();
  console.log(`Nombre d'interfaces: ${Object.keys(interfaces || {}).length}`);
  
  for (const name of Object.keys(interfaces || {})) {
    const iface = interfaces![name];
    if (iface) {
      for (const addr of iface) {
        console.log(`  Interface ${name}: ${addr.address} (internal: ${addr.internal}, family: ${addr.family})`);
        if (addr.family === "IPv4" && !addr.internal) {
          // Filtrer les IPs Docker (172.16.0.0/12)
          const ipParts = addr.address.split(".");
          const firstOctet = parseInt(ipParts[0]);
          const secondOctet = parseInt(ipParts[1]);
          
          // IPs Docker: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
          const isDockerIP = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
          
          if (!isDockerIP && addr.address !== "127.0.0.1") {
            console.log(`✓ IP depuis fallback (os.networkInterfaces): ${addr.address}`);
            return addr.address;
          } else {
            console.log(`  IP rejetée (Docker ou loopback): ${addr.address}`);
          }
        }
      }
    }
  }
  
  console.log("✗ Aucune IP trouvée après toutes les méthodes, retour de 'Non disponible'");
  console.log("=== Fin de la récupération de l'IP ===");
  return "Non disponible";
}

// Fonction pour obtenir l'utilisation du disque depuis l'hôte
function getHostDiskUsage(): number {
  try {
    // Utiliser statfs pour obtenir les stats du disque
    // Essayer d'abord avec /proc/1/root pour accéder au disque de l'hôte
    let rootPath = "/";
    if (fs.existsSync("/proc/1/root")) {
      rootPath = "/proc/1/root/";
    }
    
    try {
      const stats = fs.statfsSync(rootPath);
      const total = stats.blocks * stats.bsize;
      const free = stats.bavail * stats.bsize;
      const used = total - free;
      const usage = (used / total) * 100;
      return Math.min(Math.max(usage, 0), 100);
    } catch (e: any) {
      console.log("Erreur statfs:", e.message);
    }
    
    // Fallback: utiliser la commande df si disponible
    try {
      const dfResult = execSync("df -h / 2>/dev/null", { encoding: "utf-8", timeout: 2000 });
      const lines = dfResult.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].trim().split(/\s+/);
        if (parts.length >= 5) {
          // Format: Filesystem Size Used Avail Use% Mounted on
          // parts[4] contient le pourcentage avec %
          const usageStr = parts[4].replace("%", "");
          const usage = parseFloat(usageStr);
          if (!isNaN(usage)) {
            return Math.min(Math.max(usage, 0), 100);
          }
        }
      }
    } catch (e: any) {
      console.log("Erreur df:", e.message);
    }
  } catch (error: any) {
    console.log("Erreur lors de la récupération de l'utilisation disque:", error.message);
  }
  
  return 0;
}

export async function GET() {
  try {
    const hostMounted = isHostMounted();
    console.log("Volumes hôte montés?", hostMounted);

    const memory = getHostMemory();
    const cpuInfo = getHostCPUInfo();
    const cpuUsage = getHostCPUUsage();
    const diskUsage = getHostDiskUsage();

    // Calculer les stats du disque pour afficher les valeurs en GB
    let diskTotal = 0;
    let diskUsed = 0;
    let diskFree = 0;
    try {
      let rootPath = "/";
      if (fs.existsSync("/proc/1/root")) {
        rootPath = "/proc/1/root/";
      }
      const stats = fs.statfsSync(rootPath);
      diskTotal = stats.blocks * stats.bsize;
      diskFree = stats.bavail * stats.bsize;
      diskUsed = diskTotal - diskFree;
    } catch (e) {
      // Si erreur, on garde 0
    }

    return NextResponse.json({
      memory: {
        total: memory.total,
        free: memory.free,
        available: memory.available,
        used: memory.total - memory.available,
      },
      cpu: {
        count: cpuInfo.count,
        usage: cpuUsage,
      },
      disk: {
        total: diskTotal,
        used: diskUsed,
        free: diskFree,
        usage: diskUsage,
      },
      hostMounted,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des infos système:", error);
    return NextResponse.json(
      { error: "Erreur lors de la récupération des informations système" },
      { status: 500 }
    );
  }
}

