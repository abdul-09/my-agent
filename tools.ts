import { tool } from "ai";
import { simpleGit, type SimpleGit } from "simple-git";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

// Constants
const EXCLUDED_FILES = new Set(["dist", "bun.lock", "node_modules", ".git", "coverage"]);
const DEFAULT_OPTIONS = {
  maxConcurrentDiffs: 10,
  maxCommitMessageLength: 72
};

// Schemas
const fileChangeSchema = z.object({
  rootDir: z.string().min(1).describe("The root directory to analyze for changes"),
  excludePatterns: z.array(z.string()).optional().describe("Additional files/directories to exclude"),
});

const commitMessageSchema = z.object({
  changes: z.array(z.object({
    file: z.string(),
    changes: z.number().optional(),
    diff: z.string().optional()
  })).describe("Array of file changes to generate commit message for"),
  commitType: z.enum(["feat", "fix", "docs", "style", "refactor", "test", "chore"]).optional().describe("Type of commit"),
  scope: z.string().optional().describe("Scope of the changes (e.g., component name)")
});

const markdownReportSchema = z.object({
  reviewContent: z.string().describe("The code review content to write to markdown"),
  outputPath: z.string().optional().describe("Path where the markdown file should be saved"),
  fileName: z.string().optional().describe("Name of the markdown file")
});

const codeReviewSchema = z.object({
  rootDir: z.string().min(1).describe("The root directory to review"),
  excludePatterns: z.array(z.string()).optional(),
  outputReport: z.boolean().optional().describe("Whether to generate a markdown report")
});

// Types
type FileChangeParams = z.infer<typeof fileChangeSchema>;
type CommitMessageParams = z.infer<typeof commitMessageSchema>;
type MarkdownReportParams = z.infer<typeof markdownReportSchema>;
type CodeReviewParams = z.infer<typeof codeReviewSchema>;

interface FileDiff {
  file: string;
  diff: string;
  changes: number;
}

interface GitFileStatus {
  file: string;
  changes: number;
  insertions: number;
  deletions: number;
}

interface CodeReviewResult {
  changes: FileDiff[];
  summary: string;
  suggestions: string[];
  commitMessage?: string;
  reportPath?: string;
}

// Utility Functions
function shouldExcludeFile(filePath: string, additionalExcludes: Set<string> = new Set()): boolean {
  const allExcludes = new Set([...EXCLUDED_FILES, ...additionalExcludes]);
  return Array.from(allExcludes).some(exclude => 
    filePath.includes(exclude) || filePath.startsWith(exclude)
  );
}

async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

// Core Tools
export const getFileChangesInDirectoryTool = tool({
  description: "Gets code changes made in a git repository directory",
  inputSchema: fileChangeSchema,
  execute: getFileChangesInDirectory,
});

export const generateCommitMessageTool = tool({
  description: "Generates a conventional commit message based on file changes",
  inputSchema: commitMessageSchema,
  execute: generateCommitMessage,
});

export const writeMarkdownReportTool = tool({
  description: "Writes code review content to a markdown file",
  inputSchema: markdownReportSchema,
  execute: writeMarkdownReport,
});

export const performCodeReviewTool = tool({
  description: "Performs comprehensive code review including changes analysis, suggestions, and report generation",
  inputSchema: codeReviewSchema,
  execute: performCodeReview,
});

// Implementation Functions
async function getFileChangesInDirectory({ 
  rootDir, 
  excludePatterns = [] 
}: FileChangeParams): Promise<FileDiff[]> {
  try {
    const git: SimpleGit = simpleGit(rootDir);
    const additionalExcludes = new Set(excludePatterns);
    
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error(`Directory ${rootDir} is not a git repository`);
    }

    const summary = await git.diffSummary();
    const diffs: FileDiff[] = [];

    const filesToProcess = summary.files.filter((file: GitFileStatus) => 
      !shouldExcludeFile(file.file, additionalExcludes)
    );

    const batches = [];
    for (let i = 0; i < filesToProcess.length; i += DEFAULT_OPTIONS.maxConcurrentDiffs) {
      batches.push(filesToProcess.slice(i, i + DEFAULT_OPTIONS.maxConcurrentDiffs));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(async (file: GitFileStatus) => {
        try {
          const diff: string = await git.diff(["--", file.file]);
          return {
            file: file.file,
            diff,
            changes: file.changes
          };
        } catch (error) {
          console.warn(`Failed to get diff for file ${file.file}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const validDiffs = batchResults.filter((diff): diff is FileDiff => diff !== null);
      diffs.push(...validDiffs);
    }

    return diffs.sort((a, b) => b.changes - a.changes);

  } catch (error) {
    throw new Error(`Failed to get file changes: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function generateCommitMessage({ 
  changes, 
  commitType = "feat", 
  scope 
}: CommitMessageParams): Promise<string> {
  try {
    if (changes.length === 0) {
      return "chore: no changes detected";
    }

    // Convert input changes to FileDiff format
    const fileDiffs: FileDiff[] = changes.map(change => ({
      file: change.file,
      diff: change.diff || "",
      changes: change.changes || 0
    }));

    // Analyze changes to determine appropriate commit type
    const detectedType = detectCommitType(fileDiffs);
    const finalCommitType = commitType || detectedType;

    // Generate meaningful message based on changes
    const messageBody = generateMessageBody(fileDiffs);
    let commitMessage = `${finalCommitType}${scope ? `(${scope})` : ''}: ${messageBody}`;

    // Truncate if too long
    if (commitMessage.length > DEFAULT_OPTIONS.maxCommitMessageLength) {
      commitMessage = commitMessage.substring(0, DEFAULT_OPTIONS.maxCommitMessageLength - 3) + '...';
    }

    return commitMessage;

  } catch (error) {
    throw new Error(`Failed to generate commit message: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function writeMarkdownReport({ 
  reviewContent, 
  outputPath = "./code-reviews", 
  fileName = `code-review-${new Date().toISOString().split('T')[0]}.md`
}: MarkdownReportParams): Promise<string> {
  try {
    const fullPath = path.join(outputPath, fileName);
    await ensureDirectoryExists(fullPath);

    const markdownContent = `# Code Review Report\n\n**Date:** ${new Date().toLocaleString()}\n\n## Review Summary\n\n${reviewContent}\n\n---\n*Generated by Code Review Agent*`;

    await fs.writeFile(fullPath, markdownContent, 'utf-8');
    return `Markdown report saved to: ${fullPath}`;

  } catch (error) {
    throw new Error(`Failed to write markdown report: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function performCodeReview({ 
  rootDir, 
  excludePatterns = [], 
  outputReport = false 
}: CodeReviewParams): Promise<CodeReviewResult> {
  try {
    // Get file changes
    const changes = await getFileChangesInDirectory({ rootDir, excludePatterns });
    
    if (changes.length === 0) {
      return {
        changes: [],
        summary: "No changes detected for review",
        suggestions: ["No changes to review"]
      };
    }

    // Convert changes to the format expected by generateCommitMessage
    const commitMessageChanges = changes.map(change => ({
      file: change.file,
      changes: change.changes,
      diff: change.diff
    }));

    // Generate commit message
    const commitMessage = await generateCommitMessage({ changes: commitMessageChanges });

    // Analyze changes for review
    const summary = generateReviewSummary(changes);
    const suggestions = generateSuggestions(changes);

    let reportPath: string | undefined;
    if (outputReport) {
      const reportContent = `## Changes Summary\n${summary}\n\n## Suggestions\n${suggestions.map(s => `- ${s}`).join('\n')}\n\n## Commit Message\n\`${commitMessage}\``;
      const result = await writeMarkdownReport({ reviewContent: reportContent });
      reportPath = result;
    }

    return {
      changes,
      summary,
      suggestions,
      commitMessage,
      reportPath
    };

  } catch (error) {
    throw new Error(`Failed to perform code review: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Helper Functions
function detectCommitType(changes: FileDiff[]): string {
  const fileExtensions = changes.map(change => path.extname(change.file));
  
  if (fileExtensions.some(ext => ['.test.', '.spec.'].some(testExt => ext.includes(testExt)))) {
    return "test";
  }
  if (changes.some(change => change.file.includes('README') || change.file.includes('docs/'))) {
    return "docs";
  }
  if (changes.some(change => change.file.includes('fix') || change.file.includes('bug'))) {
    return "fix";
  }
  
  return "feat";
}

function generateMessageBody(changes: FileDiff[]): string {
  const mainFiles = changes.filter(change => 
    !change.file.includes('test') && 
    !change.file.includes('spec') &&
    !change.file.includes('README')
  );

  if (mainFiles.length === 0) {
    return "update documentation and tests";
  }

  const primaryFile = mainFiles[0];
  const fileName = path.basename(primaryFile.file, path.extname(primaryFile.file));
  
  return `update ${fileName} with ${changes.length} file${changes.length > 1 ? 's' : ''} changed`;
}

function generateReviewSummary(changes: FileDiff[]): string {
  const totalChanges = changes.reduce((sum, change) => sum + change.changes, 0);
  const fileTypes = new Set(changes.map(change => path.extname(change.file)));
  
  return `Reviewed ${changes.length} files with ${totalChanges} total changes. File types: ${Array.from(fileTypes).join(', ') || 'various'}`;
}

function generateSuggestions(changes: FileDiff[]): string[] {
  const suggestions: string[] = [];
  
  // Basic suggestions based on file patterns
  if (changes.some(change => change.file.endsWith('.ts') || change.file.endsWith('.tsx'))) {
    suggestions.push("Consider adding TypeScript type annotations if missing");
  }
  
  if (changes.some(change => change.file.includes('test') || change.file.includes('spec'))) {
    suggestions.push("Verify test coverage for the implemented changes");
  }
  
  if (changes.length > 5) {
    suggestions.push("Consider breaking this into smaller, focused commits");
  }
  
  if (suggestions.length === 0) {
    suggestions.push("Changes look good. Consider adding comments for complex logic");
  }
  
  return suggestions;
}

// Additional Utility Tools
export const getStagedChangesTool = tool({
  description: "Gets currently staged changes in the git repository",
  inputSchema: z.object({ rootDir: z.string() }),
  execute: async ({ rootDir }: { rootDir: string }) => {
    const git = simpleGit(rootDir);
    const diff = await git.diff(["--staged"]);
    return diff;
  }
});

export const getBranchInfoTool = tool({
  description: "Gets information about current git branch",
  inputSchema: z.object({ rootDir: z.string() }),
  execute: async ({ rootDir }: { rootDir: string }) => {
    const git = simpleGit(rootDir);
    const branch = await git.branch();
    const status = await git.status();
    return {
      current: branch.current,
      branches: branch.all,
      ahead: status.ahead,
      behind: status.behind
    };
  }
});