import { stepCountIs, streamText } from "ai";
import { google } from "@ai-sdk/google";
import { SYSTEM_PROMPT } from "./prompts";
import { 
  getFileChangesInDirectoryTool, 
  generateCommitMessageTool, 
  writeMarkdownReportTool, 
  performCodeReviewTool,
  getStagedChangesTool,
  getBranchInfoTool
} from "./tools";

const codeReviewAgent = async (prompt: string) => {
  const result = streamText({
    model: google("models/gemini-2.0-flash"),
    prompt,
    system: SYSTEM_PROMPT,
    tools: {
      getFileChangesInDirectoryTool,
      generateCommitMessageTool,
      writeMarkdownReportTool,
      performCodeReviewTool,
      getStagedChangesTool,
      getBranchInfoTool
    },
    stopWhen: stepCountIs(15), // Increased step count for more complex operations
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  // Get the final result for additional processing if needed
  const finalResult = await result;
  return finalResult;
};

// Enhanced main function with better error handling and options
async function main() {
  try {
    console.log("🤖 Code Review Agent Starting...\n");
    
    // Example usage with different prompts
    const reviewPrompt = "Review the code changes in '../my-agent' directory, make your reviews and suggestions file by file and generate a markdown report";
    
    await codeReviewAgent(reviewPrompt);

    // You can also use specific tool-focused prompts:
    
    await codeReviewAgent(
      "Get the current branch information for '../my-agent' directory"
    );

    await codeReviewAgent(
      "Generate a commit message for the changes in '../my-agent' directory with scope 'authentication'"
    );

    await codeReviewAgent(
      "Perform a comprehensive code review of '../my-agent' including generating a markdown report"
    );

  } catch (error) {
    console.error("❌ Error running code review agent:", error);
    process.exit(1);
  }
}

// Run the agent
await main();

// Export for use in other modules
export { codeReviewAgent };