// Ollama local CPU model configuration and orchestration service
export interface OllamaConfig {
  endpoint: string;
  model: string;
  preferredProvider: 'ollama' | 'gemini';
  simulate: boolean; // Simulation toggle for demo/unreachable environments
}

export interface OllamaModel {
  name: string;
  size?: number;
  family?: string;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  endpoint: 'http://127.0.0.1:11434',
  model: 'llama3.2',
  preferredProvider: 'ollama',
  simulate: false, // Default to false so the system automatically detects real local models first!
};

export function getOllamaConfig(): OllamaConfig {
  try {
    const saved = localStorage.getItem('hempforge_ollama_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_OLLAMA_CONFIG, ...parsed };
    }
  } catch (err) {
    console.error('Error loading Ollama config:', err);
  }
  return DEFAULT_OLLAMA_CONFIG;
}

export function setOllamaConfig(config: Partial<OllamaConfig>): void {
  try {
    const current = getOllamaConfig();
    const updated = { ...current, ...config };
    localStorage.setItem('hempforge_ollama_config', JSON.stringify(updated));
  } catch (err) {
    console.error('Error saving Ollama config:', err);
  }
}

// Check local Ollama tags to discover available local CPU models
export async function detectLocalModels(endpoint: string, bypassSimulate: boolean = false): Promise<OllamaModel[]> {
  const config = getOllamaConfig();
  if (config.simulate && !bypassSimulate) {
    // Return high-fidelity local models for edge simulation
    return [
      { name: 'llama3.2:latest', size: 2020000000, family: 'llama' },
      { name: 'qwen2.5:1.5b', size: 980000000, family: 'qwen' },
      { name: 'gemma2:2b', size: 1600000000, family: 'gemma' },
      { name: 'phi3:latest', size: 2200000000, family: 'phi' },
    ];
  }

  // We will scan standard loopback options in sequence. If the configured endpoint fails,
  // we try standard defaults to proactively connect to the user's local instance.
  const endpointsToTry = [
    endpoint,
    'http://127.0.0.1:11434',
    'http://localhost:11434',
    'http://[::1]:11434'
  ].map(ep => ep.trim()).filter((item, index, self) => self.indexOf(item) === index);

  let lastError: any = null;

  for (const currentEndpoint of endpointsToTry) {
    const url = `${currentEndpoint.replace(/\/$/, '')}/api/tags`;
    try {
      // Create controller with 2.5 second timeout to avoid blocking the UI too long during discovery
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Failed to contact local Ollama on ${currentEndpoint} (Status ${res.status})`);
      }

      const data = await res.json();
      if (data && Array.isArray(data.models)) {
        // Automatically save the successful endpoint so future requests map there seamlessly
        if (currentEndpoint !== endpoint) {
          console.log(`Automatically detected working local Ollama at: ${currentEndpoint}`);
          setOllamaConfig({ endpoint: currentEndpoint });
        }
        return data.models.map((m: any) => ({
          name: m.name || m.model,
          size: m.size,
          family: m.details?.family || (m.details?.families && m.details.families[0]) || 'unknown',
        }));
      }
    } catch (err) {
      console.warn(`Local model detection failed for ${currentEndpoint}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to reach any local Ollama endpoint (checked: ${endpointsToTry.join(', ')})`);
}

// GxP tool parameters parsing and executing
export interface ToolResult {
  toolName: string;
  args: Record<string, any>;
  output: string;
}

export function runLocalTool(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'calculate_total_thc': {
      const thca = parseFloat(args.thca || args.THCa || '0');
      const d9thc = parseFloat(args.d9thc || args.d9THC || args.d9 || '0');
      const totalThc = parseFloat(((thca * 0.877) + d9thc).toFixed(3));
      const status = totalThc > 0.3 ? 'Non-Compliant' : totalThc >= 0.25 ? 'At Risk' : 'Compliant';
      const response = {
        totalThc,
        status,
        formula: 'Total THC = (THCa * 0.877) + d9-THC',
        alert: totalThc > 0.3 
          ? 'Dry weight Total THC exceeds legal NC limit (0.3% max).' 
          : totalThc >= 0.25 
          ? 'Warning: Total THC approaches the regulatory limit.' 
          : 'Status is compliant for distribution.'
      };
      return JSON.stringify(response, null, 2);
    }
    case 'simulate_decarb_kinetics': {
      const temp = parseFloat(args.temp || args.temperature || '120');
      const duration = parseFloat(args.duration || args.time || '30');
      
      const T_kelvin = temp + 273.15;
      const R = 8.314;
      const Ea = 86400; // J/mol
      const A = 1.2e10; // pre-exponential factor
      const k = A * Math.exp(-Ea / (R * T_kelvin)); // rate per minute
      const fractionRemaining = Math.exp(-k * duration);
      const conversion = (1 - fractionRemaining) * 0.877;

      const response = {
        temperatureCelcius: temp,
        durationMinutes: duration,
        rateConstantK: parseFloat(k.toExponential(4)),
        remainingThcaPercent: parseFloat((fractionRemaining * 100).toFixed(2)),
        convertedD9ThcPercent: parseFloat((conversion * 100).toFixed(2)),
        message: `Thermal degradation mapping complete. ${((1 - fractionRemaining) * 100).toFixed(1)}% of starting THCa converted.`
      };
      return JSON.stringify(response, null, 2);
    }
    case 'evaluate_fda_serving_cap': {
      const dose = parseFloat(args.dose_mg || args.dose || args.dosage || '0');
      const cap = 0.4;
      const status = dose > cap ? 'EXCEEDED' : 'COMPLIANT';
      const response = {
        servingDoseMg: dose,
        regulatoryCapMg: cap,
        status,
        alert: dose > cap
          ? `Serving size exceeded! FDA/NC beverage-infused cap is 0.4mg per serving.`
          : `Serving size is legally compliant.`
      };
      return JSON.stringify(response, null, 2);
    }
    default:
      return JSON.stringify({ error: `Tool '${toolName}' not found.` });
  }
}

// Parse tool call patterns like: [CALL: calculate_total_thc(thca=12.5, d9thc=0.15)]
export function parseToolCall(text: string): ToolResult | null {
  const regex = /\[CALL:\s*([a-zA-Z_0-9]+)\s*\(([^)]*)\)\]/i;
  const match = text.match(regex);
  if (!match) return null;

  const toolName = match[1].trim();
  const argsString = match[2].trim();
  const args: Record<string, any> = {};

  // Parse comma-separated arguments: param1=val1, param2=val2
  const parts = argsString.split(',');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const key = part.substring(0, eqIdx).trim();
      const val = part.substring(eqIdx + 1).trim().replace(/['"]/g, '');
      args[key] = val;
    }
  }

  return { toolName, args, output: '' };
}

export const OLLAMA_SYSTEM_PROMPT = `You are HempForge Local CPU Core Swarm Orchestrator, running locally on the user's computer via Ollama.
You are a highly analytical North Carolina hemp regulatory specialist and GxP lab auditor.
You can use powerful local tools/skills when requested. 

When a user asks you to evaluate compliance, calculate decarb curves, or check beverage caps, you MUST execute the appropriate local tool first!
To call a tool, you must reply with the exact tool calling bracket on its own line:
[CALL: tool_name(arg1=val1, arg2=val2)]

Your available local tool definitions:
1. calculate_total_thc(thca: number, d9thc: number)
   - Evaluates North Carolina & federal 0.3% dry-weight Total THC compliance.
   - Example: [CALL: calculate_total_thc(thca=0.32, d9thc=0.01)]

2. simulate_decarb_kinetics(temp: number, duration: number)
   - Models thermal conversion kinetics of THCa to Delta-9-THC using Arrhenius factors.
   - Example: [CALL: simulate_decarb_kinetics(temp=140, duration=45)]

3. evaluate_fda_serving_cap(dose_mg: number)
   - Validates beverage and edible formulations against the 0.4mg FDA single-serving Delta-9 THC limit.
   - Example: [CALL: evaluate_fda_serving_cap(dose_mg=0.75)]

When you output a tool call:
- Do not output any other explanations in that turn. Just output the [CALL: ...] line.
- The system will run the tool and return the output as a [RESULT: ...] in your next chat history turn.
- Once you receive the [RESULT: ...], evaluate the numbers scientifically, quote the formulas, and present a professional, polished regulatory synthesis for the user. Mention that this calculation was executed via your local CPU core processing tools.`;

// Send a chat request to local Ollama
export async function queryLocalOllama(
  endpoint: string,
  model: string,
  prompt: string,
  history: any[],
  systemPrompt: string = OLLAMA_SYSTEM_PROMPT
): Promise<string> {
  const config = getOllamaConfig();

  if (config.simulate) {
    // Local Simulation engine with real Tool-calling patterns!
    const query = prompt.toLowerCase();
    
    // Check if the user is submitting a tool result
    if (query.includes('[result:')) {
      return `### Simulated ${model} Response (Executed locally on CPU core)
      
Based on the verified local hardware calculation:
- **Total THC Formula applied**: $Total\\;THC = (THCa \\times 0.877) + D9THC$
- **Synthesis**: The resulting dry-weight Total THC is within the legal compliance standard of **0.30%** for North Carolina hemp distribution. 

No corrective harvest modifications or pre-emptive solvent extraction overrides are required for this specific batch. You may safely initiate GxP transport tracking in the HempForge database.`;
    }

    if (query.includes('decarb') || query.includes('kinetics') || query.includes('temp') || query.includes('duration')) {
      // Find numbers for temperature and duration if possible
      const tempMatch = query.match(/(\d+)\s*(?:c|°c|degrees)/i) || query.match(/temp(?:erature)?\s*=\s*(\d+)/i);
      const durMatch = query.match(/(\d+)\s*(?:m|min|minutes)/i) || query.match(/duration|time\s*=\s*(\d+)/i);
      const temp = tempMatch ? tempMatch[1] : '130';
      const dur = durMatch ? durMatch[1] : '35';
      return `[CALL: simulate_decarb_kinetics(temp=${temp}, duration=${dur})]`;
    }

    if (query.includes('calculate') || query.includes('compliance') || query.includes('thca') || query.includes('d9thc') || query.includes('total thc') || query.includes('thc')) {
      // Find potential decimal/fractional numbers
      const decimalPattern = /(?:thca|thc-a)?\s*=?\s*(\d+\.?\d*)/gi;
      const matches = [...query.matchAll(decimalPattern)];
      const thca = matches[0] ? matches[0][1] : '0.285';
      const d9thc = matches[1] ? matches[1][1] : '0.015';
      return `[CALL: calculate_total_thc(thca=${thca}, d9thc=${d9thc})]`;
    }

    if (query.includes('serving') || query.includes('dose') || query.includes('cap') || query.includes('beverage') || query.includes('mg')) {
      const mgMatch = query.match(/(\d+\.?\d*)\s*mg/i) || query.match(/dose(?:_mg)?\s*=\s*(\d+\.?\d*)/i);
      const dose = mgMatch ? mgMatch[1] : '0.5';
      return `[CALL: evaluate_fda_serving_cap(dose_mg=${dose})]`;
    }

    // Default conversational response mimicking a highly analytical local Ollama core
    return `### Simulated ${model} Core Response (Edge processing active)

Hello! I am ${model}, running in a local-simulation sandbox mode on your physical machine.

I specialize in:
1. **Compliance calculations**: Run \`calculate_total_thc(thca=0.28, d9thc=0.03)\`
2. **Kinetics Simulations**: Run \`simulate_decarb_kinetics(temp=140, duration=45)\`
3. **Beverage/Edible cap audits**: Run \`evaluate_fda_serving_cap(dose_mg=0.5)\`

Please enter a prompt like *"Calculate Total THC for THCa 0.35 and D9THC 0.02"* or *"Simulate decarb curve for 140°C for 25 minutes"* and I will trigger my high-speed tool calls to compute it instantly in your browser container.`;
  }

  // Real Ollama Fetch call
  const url = `${endpoint.replace(/\/$/, '')}/api/chat`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(msg => ({
      role: msg.role === 'agent' ? 'assistant' : msg.role,
      content: msg.content
    })),
    { role: 'user', content: prompt }
  ];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama model response failed (Status ${res.status})`);
    }

    const data = await res.json();
    return data?.message?.content || '';
  } catch (err) {
    console.error('Ollama Query Error:', err);
    throw err;
  }
}
