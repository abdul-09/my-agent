import * as path from "path";

export function validateDirectoryPath(inputPath: string): string {
  // Resolve relative paths
  const resolvedPath = path.resolve(inputPath);
  
  // Remove any trailing slashes
  return resolvedPath.replace(/[\/\\]+$/, '');
}

export function formatFileChanges(changes: Array<{file: string; changes: number; diff?: string}>): string {
  return changes.map(change => 
    `📄 ${change.file} (${change.changes} changes)`
  ).join('\n');
}

export function createReviewSummary(changesCount: number, fileTypes: string[]): string {
  return `Reviewed ${changesCount} files with types: ${fileTypes.join(', ')}`;
}