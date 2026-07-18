"""
path_utils.py

Utility functions for handling and validating file system paths.
"""

import os


def canonicalize_path(file_path):
    """Resolve aliases through the deepest existing ancestor of a path."""
    absolute_path = os.path.abspath(file_path)
    missing_components = []
    existing_path = absolute_path

    while not os.path.exists(existing_path):
        parent_path = os.path.dirname(existing_path)
        if parent_path == existing_path:
            return os.path.normcase(absolute_path)
        missing_components.insert(0, os.path.basename(existing_path))
        existing_path = parent_path

    canonical_ancestor = os.path.realpath(existing_path)
    return os.path.normcase(os.path.join(canonical_ancestor, *missing_components))


def path_is_within(parent_path, candidate_path):
    """Return whether candidate_path is the same as or below parent_path."""
    canonical_parent = canonicalize_path(parent_path)
    canonical_candidate = canonicalize_path(candidate_path)
    try:
        return os.path.commonpath((canonical_parent, canonical_candidate)) == canonical_parent
    except ValueError:
        return False


def paths_overlap(left_path, right_path):
    """Return whether either canonical path contains the other."""
    return path_is_within(left_path, right_path) or path_is_within(right_path, left_path)

def construct_dest_path(src_path, dest_dir, date_taken):
    """
    Construct the destination file path based on the source file path,
    destination directory, and the date the file was taken.

    Args:
        src_path (str): The source file path.
        dest_dir (str): The destination directory.
        date_taken (datetime): The date the file was taken.

    Returns:
        str: The constructed destination file path.
    """
    parent_folder = os.path.basename(os.path.dirname(src_path))
    base_name, ext = os.path.splitext(os.path.basename(src_path))
    year = str(date_taken.year)
    month = f"{date_taken.month:02d}"
    day = f"{date_taken.day:02d}"
    dest_folder = os.path.join(dest_dir, year, month, day)
    dest_filename = f"{parent_folder}_{base_name}{ext}"
    return os.path.join(dest_folder, dest_filename)