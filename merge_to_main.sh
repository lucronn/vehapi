#!/bin/bash
git checkout main
git pull origin main
for pr in $(gh pr list --json number -q '.[].number'); do
    echo "Merging PR $pr"
    branch=$(gh pr view $pr --json headRefName -q .headRefName)
    git fetch origin $branch
    git merge origin/$branch --no-ff -m "Merge PR $pr" || {
        echo "Conflict, taking main's side"
        git merge --abort
        git merge origin/$branch --no-ff -m "Merge PR $pr" -X ours
    }
done
git push origin main
