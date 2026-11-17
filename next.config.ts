import type { NextConfig } from 'next';
const config: NextConfig = { serverExternalPackages: ['@openai/agents','@openai/agents-openai','@openai/agents-core'], devIndicators:false, outputFileTracingIncludes:{'/api/**/*':['./data/**/*','./examples/**/*','./templates/**/*']} };
export default config;
