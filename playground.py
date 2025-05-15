def get_bmi_weight(prompt="Enter weight in kg: "):
    """Get weight in kilograms from user."""
    while True:
        try:
            weight = float(input(prompt))
            if weight <= 0:
                print("Please enter a valid weight.")
            else:
                return weight
        except ValueError:
            print("Invalid input. Please enter a number.")

def get_bmi_height(prompt="Enter height in meters: "):
    """Get height in meters from user."""
    while True:
        try:
            height = float(input(prompt))
            if height <= 0:
                print("Please enter a valid height.")
            else:
                return height
        except ValueError:
            print("Invalid input. Please enter a number.")

def calculate_bmi(weight, height):
    """Calculate BMI using the World Health Organization's formula."""
    bmi = weight / (height ** 2)
    return round(bmi, 2)

def main():
    """Get user input for weight and height, then display BMI result."""
    print("Welcome to the BMI calculator! Enter your weight and height in meters.")
    
    # Get weight from user
    weight = get_bmi_weight()
    print(f"Your weight is: {weight} kg")
    
    # Get height from user
    height = get_bmi_height()
    print(f"Your height is: {height} m")
    
    # Calculate BMI
    bmi = calculate_bmi(weight, height)
    
    print(f"\nYour BMI is: {bmi} kg/m^2")

if __name__ == "__main__":
    main()