import subprocess
import sys
import os

def run_command(command, cwd=None):
    """Runs a shell command and prints its output."""
    print(f"Executing: {command}")
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            shell=True,
            check=True,
            text=True,
            capture_output=True
        )
        print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {e}")
        print(e.stderr)
        return False

def main():
    # Targeted directory
    repo_dir = r"x:\cursor\vehapi"
    
    # 1. Git Add
    if not run_command("git add .", cwd=repo_dir):
        sys.exit(1)
        
    # 2. Git Commit
    commit_msg = "fix(nav): sync desktop detection with tailwind md and integrate common issues section"
    if not run_command(f'git commit -m "{commit_msg}"', cwd=repo_dir):
        # Continue if nothing to commit
        pass
        
    # 3. Git Push
    run_command("git push", cwd=repo_dir)
    
    # 4. Vercel Deploy
    print("\nStarting Vercel Deployment...")
    # Check if Vercel CLI is available
    if not run_command("vercel --version", cwd=repo_dir):
        print("Vercel CLI not found. Please install with 'npm i -g vercel'")
        sys.exit(1)
        
    print("Pushing to production...")
    if run_command("vercel --prod --confirm", cwd=repo_dir):
        print("\n✅ Deployment triggered successfully!")
        print("Check https://vercel.com/dashboard to monitor progress.")
    else:
        print("\n❌ Deployment failed.")
        sys.exit(1)

if __name__ == "__main__":
    main()
