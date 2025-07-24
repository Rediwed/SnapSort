"""
path_utils.py

Utility functions for handling and validating file system paths.
"""

import os

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