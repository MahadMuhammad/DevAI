def CalculateBMI(n1, n2):
    return (n1 / (n2 * n2))

height = float(input("Enter your height in cm: "))
weight = float(input("Enter your weight in kg: "))
bmi = CalculateBMI(weight, height**2)
print("Your BMI is:", bmi)