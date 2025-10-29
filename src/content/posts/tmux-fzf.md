+++
title = 'tmux + fzf'
date = 2025-03-28T10:44:01+07:00
draft = false 
+++

## tmux

If you are unfamiliar with tmux, you can read more about it
[here](https://github.com/tmux/tmux/wiki). But the best way to get started
is to try it out yourself.

### tl;dr: What is tmux?

tmux is a terminal multiplexer, it lets you:

- Run multiple terminal programs in one window.
- Switch between them easily.
- Detach and reattach sessions across different terminals - they keep running in the background.

One huge perk of tmux is the ability to create different sessions running
in a same terminal. This allows us to navigate between sessions without
disrupting the process of other sessions.

Furthermore, a session can have different windows (or tabs in a familiar-term) that allow us to have
different processes running (think of them as browser’s tabs). Also, a
window can contain multiple panes. You can split the terminal vertically or horizontally.

These 3 things combined are what makes tmux so powerful and productive in
everyday work. All of this, e.g: create sessions,
windows, split panes,…, can be controlled entirely via the keyboard for
speed and ergonomic. Better yet, tmux is highly customizable - keybindings and behaviors can
be defined in a config file, which you can version control and reuse
across machines. Pretty neat!. Plus it looks cool.

![tmux](/images/tmux.png)

## fzf

fzf stands for fuzzy-find. You can read more about it
[here](https://github.com/junegunn/fzf).

### tl;dr: What is fzf?

- It's an interactive filter program for any kind of list; files,
command history, processes, hostnames, bookmarks, git commits, etc.
- It implements a "fuzzy" matching algorithm, so you can quickly type
in patterns with omitted characters and still get the results you want.


## Combining

You may ask what’s the connection between these two? You can actually
utilize fzf to extend tmux’s session creation to supercharge directory 
searching and opening a session to it.

For example, you're working on `<project>/` and always navigate to that
directory. However, navigating to that directory manually seems cumbersome
since you need to type `cd` lots of times! tmux+fzf will simplify that
process and make it even faster

### Setting up tmux

- Install tmux: you can follow the link above to install it.
- Create a tmux.conf in ~/.config/tmux: This will be your tmux config file
- Add this line: `bind -r f run-shell "tmux neww tms"`: This essentially
means you bind `prefix + f` (prefix by default is `Ctrl+b`, but you can
change this) to that command, which will run a script named `tms`.

### Setting up a custom script

Prerequisites:

- Install fzf, you can follow the link above to install it.

After that, follow these steps:

- Navigate to `~/.local/bin` (or whatever directory you like), create new
file `tms`. Make sure to add execution permission to it: `chmod + x
tms`.
- Make sure the directory in which you create the script is in
`PATH`. In this case, make sure `~/.local/bin` is in `PATH`.
- Copy this (explanation in comment):

```bash
#!/usr/bin/env bash

if [[ $# -eq 1 ]]; then
    selected=$1
else
    # you can change this to you prefered folder, mine is ~/personal and ~/work
    # mindepth and maxdepth = 1 mean you dont search for subfolders but only direct child
    # it then pipes the result into fzf, which then you can search
    selected=$(find ~/ ~/work ~/personal -mindepth 1 -maxdepth 1 -type d | fzf)
fi

if [[ -z $selected ]]; then
    exit 0
fi

selected_name=$(basename "$selected" | tr . _)
tmux_running=$(pgrep tmux)

# when you select a folder, tmux will create a session to that folder.
if [[ -z $TMUX ]] && [[ -z $tmux_running ]]; then
    tmux new-session -s $selected_name -c $selected
    exit 0
fi

if ! tmux has-session -t=$selected_name 2> /dev/null; then
    tmux new-session -ds $selected_name -c $selected
fi

# attach or switch to session
# this prevents creating duplicate session and instead attach to it
if [[ -z $TMUX ]]; then
    tmux attach-session -t $selected_name
else
    tmux switch-client -t $selected_name
fi

tmux switch-client -t $selected_name
```

Congratulations, now you can use this script to navigate folder and open
session even faster! Simply run `tms` in your terminal or press
`prefix + f` if you're already in a tmux session.

## My configs

You can checkout my tmux config and other awesome stuff
[here](https://github.com/nibtr/.dotfiles/blob/main/tmux/.config/tmux/tmux.conf). They’re
curated to fit my style so you might need to adjust them.
